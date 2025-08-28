#!/usr/bin/env node
/**
 * aggregate_cascade_cli_progress.js
 *
 * Cascade aggregation CLI with:
 *  - raw -> 5m -> 30m -> 2h -> 12h -> 1w
 *  - backfill (generate historical aggregated files)
 *  - synthetic raw generation
 *  - compact console progress bar while building each output file
 *
 * Usage examples:
 *   node aggregate_cascade_cli_progress.js run
 *   node aggregate_cascade_cli_progress.js backfill --from=2024-01-01 --to=2024-12-31 --gen-missing --force
 *   node aggregate_cascade_cli_progress.js gen --from=2024-12-01 --to=2024-12-10 --samplesPerMinute=1
 *
 * Notes:
 *  - Script uses UTC consistently; raw logs are expected to have Z timestamps.
 *  - Aggregated files format: bucketISO<TAB>metric<TAB>avg<TAB>count
 *
 * Author: ChatGPT (GPT-5 Thinking mini)
 */
import fs from "fs";
import path from "path";
import readline from "readline";

// ---------------- CONFIG ----------------
const ROOT = path.resolve('./logs');
const DIRS = {
    raw: ROOT,
    '5m': path.join(ROOT, '5m'),
    '30m': path.join(ROOT, '30m'),
    '2h': path.join(ROOT, '2h'),
    '12h': path.join(ROOT, '12h'),
    '1w': path.join(ROOT, '1w'),
};

// retention windows (how many days to read from lower levels when building upper levels)
const RETENTION = {
    '5m_days': 30,
    '30m_days': 90,
    '2h_days': 730,
    '12h_days': 1825,
    '1w_days': 1825,
};

// ensure directories exist
for (const d of Object.values(DIRS)) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive: true});
}

// ---------------- Helpers ----------------
function isoDateOnly(d) { return d.toISOString().slice(0, 10); }

function parseYMD(s) {
    const d = new Date(s + 'T00:00:00Z');
    if (isNaN(d)) throw new Error('Bad date: ' + s);
    return d;
}

function addDays(d, n) {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
}

function eachDateInclusive(from, to, cb) { for (let dt = new Date(from); dt <= to; dt = addDays(dt, 1)) cb(new Date(dt)); }

function todayStrUTC() { return isoDateOnly(new Date()); }

// Truncate a timestamp to the start of the bucket in UTC.
// Returns ISO string of the bucket start.
function truncateToIntervalUTC(ts, interval) {
    const d = new Date(ts);
    if (isNaN(d)) throw new Error('Invalid timestamp: ' + ts);
    switch (interval) {
        case '5m':
            d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5, 0, 0);
            break;
        case '30m':
            d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 30) * 30, 0, 0);
            break;
        case '2h': {
            d.setUTCMinutes(0, 0, 0);
            d.setUTCHours(Math.floor(d.getUTCHours() / 2) * 2);
            break;
        }
        case '12h': {
            const hour = d.getUTCHours();
            d.setUTCHours(hour < 12 ? 0 : 12, 0, 0, 0);
            break;
        }
        case '1w': {
            // week start: Monday 00:00 UTC
            const day = d.getUTCDay(); // 0..6 Sun..Sat
            const diff = (day === 0) ? -6 : 1 - day;
            d.setUTCDate(d.getUTCDate() + diff);
            d.setUTCHours(0, 0, 0, 0);
            break;
        }
        default:
            throw new Error('Unknown interval: ' + interval);
    }
    return d.toISOString();
}

// Parse a flexible line:
// - raw lines: ts metric value
// - aggregated lines: ts metric avg count
// Returns { ts, metric, value, count } or null if parse failed.
function parseLineFlexible(line) {
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const ts = parts[0];
    const metric = parts[1];
    const val = Number(parts[2]);
    if (!Number.isFinite(val)) return null;
    let count = 1;
    if (parts.length >= 4) {
        const p = Number(parts[3]);
        if (Number.isFinite(p) && p > 0) count = Math.floor(p);
    }
    return {ts, metric, value: val, count};
}

// Find the raw file for a date: pick last file matching temp_<date>*.log
function findRawFileForDate(dateStr) {
    if (!fs.existsSync(DIRS.raw)) return null;
    const candidates = fs.readdirSync(DIRS.raw)
        .filter(f => f.startsWith('temp_') && f.includes(dateStr) && f.endsWith('.log'))
        .map(f => path.join(DIRS.raw, f))
        .sort();
    if (!candidates.length) return null;
    return candidates[candidates.length - 1];
}

// Return array of file paths for last N days of the given prefix (prefix = '5m','30m','2h', etc).
// Files are expected as agg_<prefix>_YYYY-MM-DD.log
function filesForLastNDays(dir, prefix, days, endDate = null) {
    if (!fs.existsSync(dir)) return [];
    const res = [];
    const end = endDate ? new Date(endDate) : new Date();
    for (let i = 0; i < days; i++) {
        const dt = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
        dt.setUTCDate(dt.getUTCDate() - i);
        const dateStr = isoDateOnly(dt);
        const fname = `agg_${prefix}_${dateStr}.log`;
        const fpath = path.join(dir, fname);
        if (fs.existsSync(fpath)) res.push(fpath);
    }
    return res.reverse(); // oldest -> newest
}

function outName(prefix, tag, dateStr) {
    // e.g. ./logs/30m/agg_30m_last90d_2025-08-27.log
    return path.join(DIRS[prefix], `agg_${prefix}_${dateStr}.log`);
}

// ---------------- Progress UI ----------------
// Simple progress bar for files processed while building a single output file.
// Overwrites a single console line with progress.
// Example: [#####-----]  42%  (5/12) processing: agg_5m_2025-08-27.log
function renderFileProgress(currentIndex, totalFiles, currentFileName, linesReadSoFar) {
    const barWidth = 30;
    const frac = totalFiles === 0 ? 1 : (currentIndex / totalFiles);
    const filled = Math.round(frac * barWidth);
    const bar = '[' + '#'.repeat(filled) + '-'.repeat(barWidth - filled) + ']';
    const percent = Math.round(frac * 100).toString().padStart(3, ' ');
    const shortName = path.basename(currentFileName || '');
    const info = ` ${percent}% (${currentIndex}/${totalFiles}) reading: ${shortName}  lines_read: ${linesReadSoFar}`;
    // pad or trim to keep single-line behavior
    const line = bar + info;
    process.stdout.write('\r' + line.slice(0, process.stdout.columns - 1));
}

// Clear progress line after finished
function clearProgressLine() {
    process.stdout.write('\r' + ' '.repeat(Math.max(process.stdout.columns - 1, 80)) + '\r');
}

// ---------------- Core streaming aggregator ----------------
// Aggregate many input files into one output interval file.
// Shows compact progress bar while processing input files and prints a final summary.
// inputFiles: array of full paths
// interval: '5m'|'30m'|'2h'|'12h'|'1w'
// outFile: full path for output
async function aggregateFilesToInterval(inputFiles, interval, outFile) {
    if (!inputFiles || inputFiles.length === 0) {
        console.log(`\n[${interval}] No input files -> skipping ${path.basename(outFile)}`);
        return {written: 0, buckets: 0, linesRead: 0, filesRead: 0};
    }

    console.log(`\n[${interval}] Building: ${path.basename(outFile)}  (inputs: ${inputFiles.length})`);
    const aggregates = Object.create(null);
    let totalLines = 0;
    let filesProcessed = 0;

    // iterate input files; show progress per file processed.
    for (let i = 0; i < inputFiles.length; i++) {
        const f = inputFiles[i];
        filesProcessed++;
        // update progress with current file and current lines
        renderFileProgress(filesProcessed - 1, inputFiles.length, f, totalLines);

        // use readline to stream line-by-line
        try {
            const rl = readline.createInterface({input: fs.createReadStream(f), crlfDelay: Infinity});
            let fileLines = 0;
            for await (const line of rl) {
                const rec = parseLineFlexible(line);
                if (!rec) continue;
                const bucket = truncateToIntervalUTC(rec.ts, interval);
                aggregates[bucket] ||= Object.create(null);
                aggregates[bucket][rec.metric] ||= {sum: 0, count: 0};
                aggregates[bucket][rec.metric].sum += rec.value * rec.count;
                aggregates[bucket][rec.metric].count += rec.count;
                fileLines++;
                totalLines++;
            }
            rl.close();
            // advance progress to show we've completed processing this file
            renderFileProgress(filesProcessed, inputFiles.length, f, totalLines);
        } catch (err) {
            // On read error, show a short message but continue with other files.
            clearProgressLine();
            console.log(`[${interval}] Warning: failed reading ${path.basename(f)}: ${err.message}`);
        }
    }

    // done reading inputs; clear progress line before printing summary
    clearProgressLine();

    const buckets = Object.keys(aggregates).sort();
    console.log(`[${interval}] Input files processed: ${filesProcessed}, total lines read: ${totalLines}, buckets: ${buckets.length}`);

    // write aggregated output to a tmp file first
    const tmpOut = outFile + '.tmp';
    const outStream = fs.createWriteStream(tmpOut, {encoding: 'utf8'});
    let writtenLines = 0;
    for (const bucket of buckets) {
        const metrics = aggregates[bucket];
        const metricNames = Object.keys(metrics).sort();
        for (const metric of metricNames) {
            const {sum, count} = metrics[metric];
            const avg = (count > 0) ? (sum / count) : 0;
            outStream.write(`${bucket}\t${metric}\t${avg.toFixed(2)}\t${count}\n`);
            writtenLines++;
        }
    }
    await new Promise(res => outStream.end(res));
    fs.renameSync(tmpOut, outFile);

    console.log(`[${interval}] Wrote ${writtenLines} lines -> ${path.basename(outFile)} (files_read=${filesProcessed}, lines_read=${totalLines}, buckets=${buckets.length})`);
    return {written: writtenLines, buckets: buckets.length, linesRead: totalLines, filesRead: filesProcessed};
}

// ---------------- File cleanup ----------------
// Remove old daily agg files for a prefix (optional cleanup).
function cleanupOldDailyFiles(prefix, retentionDays) {
    const dir = DIRS[prefix];
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.startsWith(`agg_${prefix}_`) && f.endsWith('.log'));
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
    for (const f of files) {
        const m = f.match(/(\d{4}-\d{2}-\d{2})/);
        if (!m) continue;
        const fileDate = new Date(m[1] + 'T00:00:00Z');
        if (fileDate < cutoff) {
            try {
                fs.unlinkSync(path.join(dir, f));
                console.log(`[cleanup] removed ${f}`);
            } catch (e) {
                console.log(`[cleanup] error removing ${f}: ${e.message}`);
            }
        }
    }
}

// ---------------- Generation / Backfill helpers ----------------

// generate 5m from raw for a single date
async function generate5mForDate(dateStr, opts = {force: false, genMissing: false, genSamplesPerMinute: 1}) {
    const out5m = path.join(DIRS['5m'], `agg_5m_${dateStr}.log`);
    if (fs.existsSync(out5m) && !opts.force) {
        console.log(`[5m:${dateStr}] Output exists, skipping (use --force to overwrite): ${path.basename(out5m)}`);
        return out5m;
    }
    let raw = findRawFileForDate(dateStr);
    if (!raw) {
        if (opts.genMissing) {
            console.log(`[5m:${dateStr}] Raw missing; generating synthetic raw because genMissing=true`);
            raw = generateSyntheticRawForDate(dateStr, {samplesPerMinute: opts.genSamplesPerMinute});
        } else {
            console.log(`[5m:${dateStr}] Raw not found; skipping 5m (use --gen-missing to auto-generate)`);
            return null;
        }
    }
    await aggregateFilesToInterval([raw], '5m', out5m);
    return out5m;
}

// generate synthetic raw log for a date; returns path to generated raw file
function generateSyntheticRawForDate(dateStr, {samplesPerMinute = 1} = {}) {
    const fname = `temp_${dateStr}T00-00-01.log`;
    const fpath = path.join(DIRS.raw, fname);
    // If file already exists, don't overwrite
    if (fs.existsSync(fpath)) {
        console.log(`[gen] synthetic raw already exists: ${path.basename(fpath)}`);
        return fpath;
    }

    const start = new Date(dateStr + 'T00:00:00Z');
    const end = addDays(start, 1);
    const stream = fs.createWriteStream(fpath, {encoding: 'utf8'});

    // Model metrics: simple periodic functions to simulate realistic values
    const metrics = [
        (t) => `PM_10\t${Math.max(0, Math.round(10 + 5 * Math.sin(t / 60000)))}`,
        (t) => `PM_25\t${Math.max(0, Math.round(5 + 3 * Math.cos(t / 60000)))}`,
        (t) => `PM_100\t0`,
        (t) => `TVOC\t${(120 + 20 * Math.sin(t / 3600000)).toFixed(2)}`,
        (t) => `CO2\t${400 + Math.round(20 * Math.sin(t / 900000))}`,
        (t) => `TEMPERATURE\t${(20 + 5 * Math.sin(t / 3600000)).toFixed(2)}`,
        (t) => `HUMIDITY\t${(40 + 5 * Math.cos(t / 3600000)).toFixed(2)}`
    ];

    const intervalMs = Math.max(1, Math.floor(60000 / Math.max(1, samplesPerMinute)));
    for (let t = start.getTime(); t < end.getTime(); t += intervalMs) {
        const ts = new Date(t).toISOString();
        for (const m of metrics) stream.write(`${ts}\t${m(t)}\n`);
    }
    stream.end();
    console.log(`[gen] Generated synthetic raw: ${path.basename(fpath)} (samples/min=${samplesPerMinute})`);
    return fpath;
}

// Build upper-level aggregated files for a given date
// For date D, create:
//  - 30m: aggregate 5m files for last RETENTION['30m_days'] ending at D
//  - 2h: aggregate 30m files for last RETENTION['2h_days'] ending at D
//  - 12h: aggregate 2h files for last RETENTION['12h_days'] ending at D
//  - 1w: aggregate 12h files for last RETENTION['1w_days'] ending at D
async function generateUpperLevelsForDate(dateStr, opts = {force: false}) {
    console.log(`\n--- Building upper levels for ${dateStr} ---`);
    // 30m
    {
        const days = RETENTION['30m_days'];
        const inputs = filesForLastNDays(DIRS['5m'], '5m', days, new Date(dateStr + 'T00:00:00Z'));
        if (inputs.length) {
            const out30m = outName('30m', `last${days}d`, dateStr);
            if (!fs.existsSync(out30m) || opts.force) await aggregateFilesToInterval(inputs, '30m', out30m);
            else console.log(`[30m:${dateStr}] exists, skipping: ${path.basename(out30m)}`);
        } else console.log(`[30m:${dateStr}] not enough 5m inputs (need last ${days} days)`);
    }
    // 2h
    {
        const days = RETENTION['2h_days'];
        const inputs = filesForLastNDays(DIRS['30m'], '30m', days, new Date(dateStr + 'T00:00:00Z'));
        if (inputs.length) {
            const out2h = outName('2h', `last${days}d`, dateStr);
            if (!fs.existsSync(out2h) || opts.force) await aggregateFilesToInterval(inputs, '2h', out2h);
            else console.log(`[2h:${dateStr}] exists, skipping: ${path.basename(out2h)}`);
        } else console.log(`[2h:${dateStr}] not enough 30m inputs (need last ${days} days)`);
    }
    // 12h
    {
        const days = RETENTION['12h_days'];
        const inputs = filesForLastNDays(DIRS['2h'], '2h', days, new Date(dateStr + 'T00:00:00Z'));
        if (inputs.length) {
            const out12h = outName('12h', `last${days}d`, dateStr);
            if (!fs.existsSync(out12h) || opts.force) await aggregateFilesToInterval(inputs, '12h', out12h);
            else console.log(`[12h:${dateStr}] exists, skipping: ${path.basename(out12h)}`);
        } else console.log(`[12h:${dateStr}] not enough 2h inputs (need last ${days} days)`);
    }
    // 1w
    {
        const days = RETENTION['1w_days'];
        const inputs = filesForLastNDays(DIRS['12h'], '12h', days, new Date(dateStr + 'T00:00:00Z'));
        if (inputs.length) {
            const out1w = outName('1w', `last${days}d`, dateStr);
            if (!fs.existsSync(out1w) || opts.force)
                await aggregateFilesToInterval(inputs, '1w', out1w);
            else console.log(`[1w:${dateStr}] exists, skipping: ${path.basename(out1w)}`);
        } else console.log(`[1w:${dateStr}] not enough 12h inputs (need last ${days} days)`);
    }
}

// ---------------- High-level pipelines ----------------

// Daily run: process today only (normal scheduled job)
async function runDailyCascade(opts = {force: false, genMissing: false, genSamplesPerMinute: 1}) {
    const today = isoDateOnly(new Date());
    console.log(`\n=== DAILY RUN (UTC ${today}) ===`);
    await generate5mForDate(today, opts);
    await generateUpperLevelsForDate(today, opts);
    // optional cleanup to keep disk tidy
    try {
        cleanupOldDailyFiles('5m', RETENTION['5m_days'] + 7);
        cleanupOldDailyFiles('30m', RETENTION['30m_days'] + 30);
    } catch (e) {
        console.log('[cleanup] error:', e.message);
    }
    console.log('=== DAILY RUN COMPLETE ===\n');
}

// Backfill: generate 5m per day then upper levels for each date in range
async function backfill(fromStr, toStr, opts = {force: false, genMissing: false, genSamplesPerMinute: 1}) {
    const from = parseYMD(fromStr);
    const to = parseYMD(toStr);
    console.log(`\n=== BACKFILL from ${fromStr} to ${toStr} (UTC) ===`);

    // Step 1: ensure 5m for each date
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        const dateStr = isoDateOnly(d);
        try {
            await generate5mForDate(dateStr, {
                force: opts.force,
                genMissing: opts.genMissing,
                genSamplesPerMinute: opts.genSamplesPerMinute
            });
        } catch (e) {
            console.log(`[backfill][5m:${dateStr}] error: ${e.message}`);
        }
    }

    // Step 2: generate upper levels for each date
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        const dateStr = isoDateOnly(d);
        try {
            await generateUpperLevelsForDate(dateStr, {force: opts.force});
        } catch (e) {
            console.log(`[backfill][upper:${dateStr}] error: ${e.message}`);
        }
    }

    console.log('=== BACKFILL COMPLETE ===\n');
}

// Generate synthetic raw logs for a date range
function genRange(fromStr, toStr, opts = {samplesPerMinute: 1}) {
    const from = parseYMD(fromStr);
    const to = parseYMD(toStr);
    console.log(`\n=== GENERATE RAW from ${fromStr} to ${toStr} (samples/min=${opts.samplesPerMinute}) ===`);
    eachDateInclusive(from, to, (d) => {
        const dateStr = isoDateOnly(d);
        const pathToRaw = path.join(DIRS.raw, `temp_${dateStr}T00-00-01.log`);
        if (fs.existsSync(pathToRaw)) {
            console.log(`[gen] exists: ${path.basename(pathToRaw)}, skipping`);
            return;
        }
        generateSyntheticRawForDate(dateStr, {samplesPerMinute: opts.samplesPerMinute});
    });
    console.log('=== GENERATE RAW COMPLETE ===\n');
}

// ---------------- CLI Parsing ----------------
function parseArgs(argv) {
    const args = {cmd: null, opts: {}};
    if (argv.length < 3) {
        args.cmd = 'help';
        return args;
    }
    args.cmd = argv[2];
    for (let i = 3; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const [k, v] = a.slice(2).split('=');
            args.opts[k] = v === undefined ? true : v;
        }
    }
    return args;
}

// ---------------- Main ----------------
async function main() {
    const {cmd, opts} = parseArgs(process.argv);
    try {
        if (!cmd || cmd === 'help') {
            console.log('Usage: node aggregate_cascade_cli_progress.js <cmd> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--force] [--gen-missing]');
            console.log('Commands: run | backfill | gen');
            return;
        }
        if (cmd === 'run') {
            await runDailyCascade(opts);
            return;
        }
        if (cmd === 'gen') {
            const from = opts.from || opts.f;
            const to = opts.to || opts.t || from;
            if (!from || !to) {
                console.error('gen requires --from and --to');
                return;
            }
            const samples = Number(opts.samplesPerMinute || opts.s || 1);
            genRange(from, to, {samplesPerMinute: samples});
            return;
        }
        if (cmd === 'backfill') {
            const from = opts.from || opts.f;
            const to = opts.to || opts.t || from;
            if (!from || !to) {
                console.error('backfill requires --from and --to');
                return;
            }
            const force = Boolean(opts.force);
            const genMissing = Boolean(opts['gen-missing'] || opts['genMissing']);
            const spm = Number(opts.samplesPerMinute || opts.s || 1);
            await backfill(from, to, {force, genMissing, genSamplesPerMinute: spm});
            return;
        }
        console.error('Unknown command:', cmd);
    } catch (e) {
        console.error('FATAL ERROR:', e && e.stack ? e.stack : e.message || e);
        process.exitCode = 2;
    }
}

main();
