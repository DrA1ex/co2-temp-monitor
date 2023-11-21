import process from "node:process";
import fs from "node:fs/promises";

import {Input, Telegraf} from "telegraf";
import {JSONPreset} from 'lowdb/node';
import {Plot} from "text-graph.js";
import {UltimateTextToImage} from "ultimate-text-to-image";

const bot = new Telegraf(process.env.BOT_TOKEN);

const db = await JSONPreset('db.json', {
    SensorData: {
        time: "n/a",
        temperature: 0,
        co2: 0,
        humidity: 0,
        freshness: 0,
        lastUpdate: 0,
        history: {
            temperature: [],
            co2: [],
            humidity: [],
        },
        summary: {
            hours: {},
            sentDate: null
        }
    },
    Subscribers: [],
    Alert: {
        temperature: false,
        co2: false,
        freshness: false,
        humidity: false
    },
    AlertTime: {},
    Limits: {
        temperature: [25, 26],
        co2: [300, 1200],
        freshness: 90,
        humidity: [80, 95],
    },
    Admin: null,
    Settings: {
        sensorParameters: [
            {key: "temperature", name: "Temperature", unit: "Cº", dataKey: "Tamb"},
            {key: "co2", name: "CO2", unit: "ppm", dataKey: "CntR"},
            {key: "humidity", name: "Humidity", unit: "%", dataKey: "Hum"},
            {key: "freshness", name: "Freshness", unit: "sec"},
        ],
        minRefreshInterval: 1,
        historyLength: 1000,
        alertCooldown: 1.5 * 60,
        alertForcingInterval: 10 * 60,
        fileName: "./temp.log",
        alertOkPrefix: "🌿",
        alertFailedPrefix: "😱😱😱",
        notifyLimitsChanged: true,
        summaryEnabled: true,
        summaryTime: 9,
        summaryPeriod: [23, 9],
        graphSize: [80, 40],
    }
});

const DataParsingRePattern = "(.*)\\s+$KEY.+?(\\d+\\.?\\d*)";

async function readLines(fileName, linesLimit, blockSize = 32 * 1024) {
    const stats = await fs.stat(fileName);

    const blockBuffer = Buffer.alloc(blockSize);

    const file = await fs.open(fileName);
    const result = [];

    const NEW_LINE = "\n".charCodeAt(0);

    try {
        let read = 0;
        let linesRead = 0;
        let stringTail = null;
        while (read < stats.size && linesRead < linesLimit) {
            const filePos = stats.size - read - 1 - blockSize;
            const block = await file.read(blockBuffer, 0, blockSize, Math.max(0, filePos));
            read += block.bytesRead;

            let i, lastIndex = block.bytesRead;
            for (i = block.bytesRead - 1; i >= 0 && linesRead < linesLimit; i--) {
                if (blockBuffer[i] === NEW_LINE) {
                    if (lastIndex - i <= 1) {
                        lastIndex = i;
                        continue;
                    }

                    const line = blockBuffer.toString("utf-8", i + 1, lastIndex);

                    if (stringTail === null) {
                        result.push(line);
                    } else {
                        result.push(line + stringTail);
                        stringTail = null;
                    }

                    lastIndex = i;
                    linesRead++
                }
            }

            if (linesRead < linesLimit && lastIndex > 0) {
                const newTail = blockBuffer.toString("utf-8", 0, lastIndex);
                stringTail = stringTail === null ? newTail : newTail + stringTail;
            }
        }
    } finally {
        await file.close();
    }

    return result.reverse();
}

async function readData() {
    const {Settings} = db.data;
    const lines = await readLines(Settings.fileName, Settings.historyLength);

    const result = {history: {}};
    for (const param of Settings.sensorParameters) {
        if (!param.dataKey) continue;

        const re = new RegExp(DataParsingRePattern.replace("$KEY", param.dataKey));
        const data = lines.filter(l => l.includes(param.dataKey))
            .map(l => l.trim())
            .map(l => {
                    const match = l.match(re);
                    return {
                        time: match[1],
                        value: Number.parseFloat(match[2])
                    }
                }
            )

        result[param.key] = data[data.length - 1]?.value ?? 0;
        result.history[param.key] = data;
    }

    return result;
}

async function sendNotification(message) {
    const {Subscribers} = db.data;

    const promises = [];
    for (const subscriber of Subscribers) {
        promises.push(bot.telegram.sendMessage(subscriber, message, {parse_mode: "Markdown"}));
    }

    await Promise.all(promises);
}

function checkAlertCooldown(key) {
    const {AlertTime, Settings} = db.data;

    if (Settings.alertCooldown <= 0) return false;

    const lastStateChangeDelta = (new Date().getTime() - (AlertTime[key] ?? 0)) / 1000;
    if (lastStateChangeDelta <= Settings.alertCooldown) {
        console.log(new Date(), "Alert cooldown", key, lastStateChangeDelta);
        return true;
    }

    return false;
}

function checkAlertForcing(key) {
    const {AlertTime, Settings} = db.data;

    if (Settings.alertForcingInterval <= 0) return false;

    const lastStateChangeDelta = (new Date().getTime() - (AlertTime[key] ?? 0)) / 1000;
    if (lastStateChangeDelta > Settings.alertForcingInterval) {
        console.log(new Date(), "Alert forcing", key, lastStateChangeDelta);
        return true;
    }

    return false;
}

async function alert(key, description, unit) {
    const {Alert, Limits, SensorData, AlertTime, Settings} = db.data;

    const value = SensorData[key];
    const alertActive = Alert[key];
    const limits = Limits[key];

    let min, max;
    if (Array.isArray(limits)) {
        [min, max] = Limits[key];
    } else {
        [min, max] = [0, limits]
    }


    let changed = false;
    const checkFailed = value < min || value > max;
    if (checkFailed && (!alertActive || checkAlertForcing(key))) {
        if (checkAlertCooldown(key)) return false;

        Alert[key] = true;
        await sendNotification(`${Settings.alertFailedPrefix} *${description} ALERT*: _${value.toFixed(2)} ${unit}_ (Allowed: ${min}..${max})`);

        changed = true;
        console.log(new Date(), "Alert FAILED", key);
    } else if (!checkFailed && alertActive) {
        if (checkAlertCooldown(key)) return false;

        Alert[key] = false;
        await sendNotification(`${Settings.alertOkPrefix} *${description} OK*: _${value.toFixed(2)} ${unit}_`);

        changed = true;
        console.log(new Date(), "Alert OK", key);
    }

    if (changed) AlertTime[key] = new Date().getTime();

    return changed;
}

async function processAlerts() {
    const {SensorData, Settings} = db.data;
    SensorData.freshness = (new Date().getTime() - SensorData.lastUpdate) / 1000;

    let hasChanges = false;

    for (const {key, name, unit} of Settings.sensorParameters) {
        const changed = await alert(key, name, unit);
        hasChanges = hasChanges || changed;
    }

    if (hasChanges) await db.write();
}

bot.command("current", async ctx => {
    const {SensorData, Alert, Settings} = db.data;

    await ctx.replyWithMarkdown(`Your real-time sensor data as of _${SensorData.time}_:\n`
        + Settings.sensorParameters.map(s =>
            `*${s.name}*: ${SensorData[s.key].toFixed(2)} ${s.unit}. Status: ${Alert[s.key] ? "😨" : "👍"}`
        ).join("\n")
    );

    console.log(new Date(), "Current status request", ctx.message.chat.id);
});

bot.command("subscribe", async ctx => {
    const {Subscribers} = db.data;
    if (Subscribers.includes(ctx.message.chat.id)) {
        return await ctx.reply("You're already subscribed!");
    }

    Subscribers.push(ctx.message.chat.id);
    await db.write();

    await ctx.reply("You're subscribed!")

    console.log(new Date(), "Subscribed", ctx.message.chat.id);
})

bot.command("unsubscribe", async ctx => {
    const {Subscribers} = db.data;

    const index = Subscribers.indexOf(ctx.message.chat.id);
    if (index === -1) {
        return await ctx.reply("You're not subscribed yet!");
    }


    Subscribers.splice(index, 1);
    await db.write();

    await ctx.reply("You're unsubscribed!");

    console.log(new Date(), "Unsubscribed", ctx.message.chat.id);
})

bot.command("graph", async ctx => {
    const {SensorData, Settings} = db.data;

    const graphs = [];
    for (const param of Settings.sensorParameters) {
        const history = SensorData.history[param.key];
        if (!history) continue;

        const chart = Plot.plot(history.map(v => v.value), {
            title: `${param.name}, ${param.unit}`,
            width: Settings.graphSize[0],
            height: Settings.graphSize[1],
            axisLabelsFraction: 2,
        }).replaceAll(/\x1b\[\d+m/g, "");

        const rendered = new UltimateTextToImage(
            chart, {
                fontFamily: "monospace",
                margin: 10,
            }
        ).render();

        graphs.push({
            type: "photo", media: Input.fromBuffer(rendered.toBuffer())
        });
    }

    await ctx.replyWithMediaGroup(graphs);

    console.log(new Date(), "Graph request", ctx.message.chat.id);
})

bot.command("limit", async ctx => {
    console.log(new Date(), "Trying update limit", ctx.message.chat.id);

    const {Admin, Settings} = db.data;

    if (!Admin) return ctx.replyWithMarkdown("Admin's _ID_ not specified. Set _Admin_ field with  telegram `User.id` in `./db.json`");

    if (ctx.message.chat.id !== Admin) return ctx.reply("Access denied");

    const [, key, fromStr, toStr] = ctx.message.text.split(" ");
    const from = Number.parseFloat(fromStr);
    const to = Number.parseFloat(toStr);

    if (!key || !Number.isFinite(from) || !Number.isFinite(to)) {
        return ctx.replyWithMarkdown("Wrong parameters. Usage: _/limit <key> <from> <to>_");
    }

    if (from > to) return ctx.replyWithMarkdown("_from_ value should be greater or equal to value _to_ value");

    const {Limits} = db.data;
    if (!(key in Limits)) return ctx.reply(`Wrong parameter key: ${key}`);

    if (Array.isArray(Limits[key])) {
        Limits[key] = [from, to];
    } else {
        Limits[key] = to;
    }

    await db.write();
    ctx.reply("Saved!");

    if (Settings.notifyLimitsChanged) await sendNotification(`Limit for *${key}* changed to _${from}..${to}_`);
});

bot.command("limits", async ctx => {
    const {Limits, Settings} = db.data;
    await ctx.replyWithMarkdown([
        "_Limits:_",
        ...Settings.sensorParameters.map(s => {
            const value = Limits[s.key];
            return `- *${s.name}* (\`${s.key}\`): _${(Array.isArray(value) ? value.join(" to ") : `0 to ${value}`)} ${s.unit}_}`
        })
    ].join("\n"))

    console.log(new Date(), "Limits request", ctx.message.chat.id);
});

async function watchSensorChanges() {
    let fsWait = false;

    for await (const {filename} of fs.watch("./temp.log")) {
        const {SensorData, Settings} = db.data;

        if (!filename || fsWait) continue;

        fsWait = setTimeout(() => {
            fsWait = false;
        }, Settings.minRefreshInterval * 1000);

        const data = await readData();
        Object.assign(SensorData, data);

        SensorData.lastUpdate = new Date().getTime();

        await db.write();
    }
}

async function processSummary() {
    const {SensorData, Settings} = db.data;

    const now = new Date();
    const dateString = now.toDateString();
    const hour = now.getHours();

    let currentSummary = SensorData.summary.hours[hour]
    if (!currentSummary || currentSummary.date !== dateString) {
        currentSummary = {date: dateString, count: 0};
        for (const {key} of Settings.sensorParameters) {
            currentSummary[key] = {min: SensorData[key], max: SensorData[key], avg: SensorData[key]};
        }

        SensorData.summary.hours[hour] = currentSummary;
    }

    for (const {key} of Settings.sensorParameters) {
        _minMaxAvg(key, currentSummary, SensorData, currentSummary.count);
    }

    currentSummary.count += 1;

    if (Settings.summaryEnabled && SensorData.summary.sentDate !== dateString && hour === Settings.summaryTime) {
        SensorData.summary.sentDate = dateString;

        const from = Math.max(0, Math.min(23, Settings.summaryPeriod[0]));
        const to = Math.max(0, Math.min(23, Settings.summaryPeriod[1]));

        const periodSummary = {};
        for (const {key} of Settings.sensorParameters) {
            periodSummary[key] = {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, avg: 0};
        }

        let count = 0;
        for (let i = from; i !== to; i = (i + 1) % 24) {
            const hourData = SensorData.summary.hours[i];
            if (!hourData) continue;

            for (const {key} of Settings.sensorParameters) {
                _minMaxAvg(key, periodSummary, hourData, count);
            }

            count++
        }

        if (count > 0) {
            await sendNotification(`Hello there! Here's a _snapshot_ of the past ${count} hours `
                + `from _${from.toString().padStart(2, "0")}:00_ `
                + `to _${to.toString().padStart(2, "0")}:00_:\n`
                + Settings.sensorParameters.map(s =>
                    `- *${s.name}*: ${_formatMinMaxAvg(s.key, periodSummary, s.unit)}`).join("\n")
            );

            console.log(`Summary sent (${count} records)`);
        }
    }

    await db.write();
}

function _minMaxAvg(key, dst, src, count) {
    if (!dst[key] || !src[key]) return;

    dst[key].max = Math.max(dst[key].max, src[key].max ?? src[key]);
    dst[key].min = Math.min(dst[key].min, src[key].min ?? src[key]);
    dst[key].avg = _calculateNextAverage(dst[key].avg ?? 0, src[key].avg ?? src[key], count);
}

function _calculateNextAverage(previousAverage, currentValue, n) {
    return (previousAverage * n + currentValue) / (n + 1);
}

function _formatMinMaxAvg(key, src, unit) {
    const data = src[key];
    if (!data) return "";

    return `~ ${data.avg.toFixed(2)} ${unit} (${data.min.toFixed(2)}..${data.max.toFixed(2)})`
}

async function _alertsTimeout() {
    await processAlerts();
    setTimeout(_alertsTimeout, 5000);
}

async function _summaryTimeout() {
    await processSummary();
    setTimeout(_summaryTimeout, 60000);
}

setTimeout(watchSensorChanges);
setTimeout(_alertsTimeout);
setTimeout(_summaryTimeout);

console.log("Listening...");
await bot.launch();