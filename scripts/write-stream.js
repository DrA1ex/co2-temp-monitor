import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RATE = 1;

function parseArgs(argv) {
    const args = {
        rate: DEFAULT_RATE,
        duration: 0,
        file: '',
        sensors: [],
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--rate' || arg === '-r') {
            args.rate = Number(next);
            index += 1;
        } else if (arg === '--duration' || arg === '-d') {
            args.duration = Number(next);
            index += 1;
        } else if (arg === '--file' || arg === '-f') {
            args.file = next;
            index += 1;
        } else if (arg === '--sensors' || arg === '-s') {
            args.sensors = next.split(',').map(value => value.trim()).filter(Boolean);
            index += 1;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isFinite(args.rate) || args.rate <= 0) {
        throw new Error('--rate must be a positive number');
    }

    if (!Number.isFinite(args.duration) || args.duration < 0) {
        throw new Error('--duration must be a positive number or 0');
    }

    return args;
}

function printHelp() {
    console.log(`
Usage:
  npm run write-stream -- --rate 2
  node ./scripts/write-stream.js --rate 4 --duration 60

Options:
  -r, --rate <n>       Samples per second. Each sample writes all selected sensors. Default: ${DEFAULT_RATE}
  -d, --duration <s>   Stop after N seconds. Default: 0, run until Ctrl+C
  -f, --file <path>    Target stream log file. Default: Settings.fileName from db.json
  -s, --sensors <csv>  Sensor data keys to write, e.g. TEMPERATURE,CO2,HUMIDITY
  -h, --help           Show this help
`.trim());
}

async function readSettings() {
    const raw = await readFile('db.json', 'utf8');
    const data = JSON.parse(raw);
    const settings = data.Settings;

    if (!settings?.fileName) {
        throw new Error('Database is missing Settings.fileName');
    }

    return settings;
}

function getSelectedSensors(settings, selectedKeys) {
    const sensors = settings.sensorParameters
        .filter(sensor => sensor.dataKey)
        .map(sensor => ({
            key: sensor.key,
            name: sensor.name,
            dataKey: sensor.dataKey,
            fraction: sensor.fraction ?? 2,
        }));

    if (!selectedKeys.length) return sensors;

    const selected = new Set(selectedKeys.map(key => key.toUpperCase()));
    return sensors.filter(sensor => selected.has(sensor.dataKey.toUpperCase()) || selected.has(sensor.key.toUpperCase()));
}

function round(value, fraction) {
    const scale = 10 ** fraction;
    return Math.round(value * scale) / scale;
}

function getValue(dataKey, elapsedSeconds, sampleIndex) {
    const wave = Math.sin(elapsedSeconds / 19);
    const slowWave = Math.sin(elapsedSeconds / 73);
    const jitter = Math.sin(sampleIndex * 1.618) * 0.08;

    switch (dataKey) {
        case 'TEMPERATURE':
            return 24 + wave * 0.9 + slowWave * 0.35 + jitter;
        case 'HUMIDITY':
            return 45 + Math.cos(elapsedSeconds / 27) * 7 + slowWave * 2;
        case 'CO2':
            return 430 + Math.round(Math.sin(elapsedSeconds / 31) * 45 + slowWave * 25);
        case 'PM_10':
            return Math.max(0, Math.round(8 + Math.sin(elapsedSeconds / 11) * 5 + jitter * 12));
        case 'PM_25':
            return Math.max(0, Math.round(4 + Math.sin(elapsedSeconds / 13) * 3 + jitter * 8));
        case 'PM_100':
            return Math.max(0, Math.round(1 + Math.sin(elapsedSeconds / 17) * 2 + jitter * 4));
        case 'TVOC':
            return 120 + Math.sin(elapsedSeconds / 37) * 18 + slowWave * 12;
        default:
            return 10 + wave * 2 + jitter;
    }
}

function formatSensorValue(sensor, elapsedSeconds, sampleIndex) {
    const value = getValue(sensor.dataKey, elapsedSeconds, sampleIndex);
    return round(value, sensor.fraction);
}

async function write(stream, chunk) {
    if (stream.write(chunk)) return;
    await new Promise(resolve => stream.once('drain', resolve));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const settings = await readSettings();
    const fileName = args.file || settings.fileName;
    const sensors = getSelectedSensors(settings, args.sensors);

    if (!sensors.length) {
        throw new Error('No sensors selected');
    }

    await fs.promises.mkdir(path.dirname(path.resolve(fileName)), {recursive: true});

    const stream = fs.createWriteStream(fileName, {flags: 'a', encoding: 'utf8'});
    const intervalMs = 1000 / args.rate;
    const startedAt = Date.now();
    const stopAt = args.duration > 0 ? startedAt + args.duration * 1000 : Number.POSITIVE_INFINITY;
    let sampleIndex = 0;
    let stopped = false;

    const stop = () => {
        stopped = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    console.log(`Writing ${sensors.length} sensors to ${fileName}`);
    console.log(`Rate: ${args.rate} samples/sec (${sensors.map(sensor => sensor.dataKey).join(', ')})`);
    if (args.duration > 0) console.log(`Duration: ${args.duration} sec`);
    console.log('Press Ctrl+C to stop.');

    while (!stopped && Date.now() < stopAt) {
        const plannedAt = startedAt + sampleIndex * intervalMs;
        const now = Date.now();
        if (plannedAt > now) {
            await new Promise(resolve => setTimeout(resolve, plannedAt - now));
            if (stopped) break;
        }
        if (Date.now() >= stopAt) break;

        const timestamp = new Date().toISOString();
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        const lines = sensors
            .map(sensor => `${timestamp}\t${sensor.dataKey}\t${formatSensorValue(sensor, elapsedSeconds, sampleIndex)}`)
            .join('\n');

        await write(stream, `${lines}\n`);
        sampleIndex += 1;
    }

    await new Promise(resolve => stream.end(resolve));
    console.log(`Stopped. Wrote ${sampleIndex} samples, ${sampleIndex * sensors.length} lines.`);
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
