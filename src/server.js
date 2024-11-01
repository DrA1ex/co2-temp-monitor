import process from "node:process";

import {Input, Telegraf} from "telegraf";
import {JSONPreset} from 'lowdb/node';
import {Plot} from "text-graph.js";
import {UltimateTextToImage} from "ultimate-text-to-image";

import * as ParsingUtils from "./utils/parsing.js";
import * as FileUtils from "./utils/file.js";

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
            {key: "temperature", name: "Temperature", unit: "Cº", fraction: 2, dataKey: "Tamb"},
            {key: "co2", name: "CO2", unit: "ppm", fraction: 0, dataKey: "CntR"},
            {key: "humidity", name: "Humidity", unit: "%", fraction: 1, dataKey: "Hum"},
            {key: "freshness", name: "Freshness", fraction: 0, unit: "sec"},
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
        graphSize: [80, 30],
    }
});

function initConfig() {
    const {Alert, Limits, SensorData, Settings} = db.data;
    for (const {key, dataKey} of Settings.sensorParameters) {
        if (!(key in Alert)) Alert[key] = false;
        if (!(key in Limits)) Limits[key] = 0;
        if (!(key in SensorData)) SensorData[key] = 0;
        if (dataKey && !(key in SensorData.history)) SensorData.history[key] = [];
    }

    for (const hourData of Object.values(SensorData.summary.hours)) {
        for (const {key} of Settings.sensorParameters) {
            if (!(key in hourData)) hourData[key] = {min: SensorData[key], max: SensorData[key], avg: SensorData[key]};
        }
    }
}


async function readData() {
    const {Settings} = db.data;

    const lines = await FileUtils.readLastLines(Settings.fileName, Settings.historyLength);
    return ParsingUtils.parseData(lines, Settings.sensorParameters);
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

async function alert(key, description, unit, fraction) {
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
        await sendNotification(`${Settings.alertFailedPrefix} *${description} ALERT*: _${value.toFixed(fraction)} ${unit}_ (Allowed: ${min}..${max})`);

        changed = true;
        console.log(new Date(), "Alert FAILED", key);
    } else if (!checkFailed && alertActive) {
        if (checkAlertCooldown(key)) return false;

        Alert[key] = false;
        await sendNotification(`${Settings.alertOkPrefix} *${description} OK*: _${value.toFixed(fraction)} ${unit}_`);

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

    for (const {key, name, unit, fraction} of Settings.sensorParameters) {
        const changed = await alert(key, name, unit, fraction);
        hasChanges = hasChanges || changed;
    }

    if (hasChanges) await db.write();
}

bot.command("current", async ctx => {
    const {SensorData, Alert, Settings} = db.data;

    await ctx.replyWithMarkdown([
        `Your real-time sensor data as of _${SensorData.time}_:`,
        ...Settings.sensorParameters.map(s =>
            `${Alert[s.key] ? "😨" : "👍"} *${s.name}*: ${SensorData[s.key].toFixed(s.fraction)} ${s.unit}`
        )].join("\n")
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

    await ctx.reply("You're subscribed!");

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

        const values = history.map(v => v.value).filter(v => Number.isFinite(v));
        const chart = Plot.plot(values, {
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
    console.log(new Date(), "Limits request", ctx.message.chat.id);

    const {Limits, Settings} = db.data;
    await ctx.replyWithMarkdown([
        "_Limits:_",
        ...Settings.sensorParameters.map(s => {
            const value = Limits[s.key];
            return `- *${s.name}* (\`${s.key}\`): _${(Array.isArray(value) ? value.join(" to ") : `0 to ${value}`)} ${s.unit}_}`
        })
    ].join("\n"))
});

bot.command("summary", async ctx => {
    console.log(new Date(), "Summary request", ctx.message.chat.id);

    const {SensorData, Settings} = db.data;

    const [, sensorKey] = ctx.message.text.split(" ");
    if (!sensorKey) {
        return await ctx.replyWithMarkdown(`Usage: _/summary <key>_`);
    }

    const sensor = Settings.sensorParameters.find(s => s.key === sensorKey);
    if (!sensor) {
        return await ctx.replyWithMarkdown(`Invalid sensor _${sensorKey}_`);
    }

    const now = new Date();
    const hour = now.getHours();

    const summary = [];

    for (let i = (hour + 1) % 24; i !== hour; i = (i + 1) % 24) {
        const hourData = SensorData.summary.hours[i];
        if (!hourData) continue;

        summary.push(Object.assign({hour: i}, hourData));
    }

    if (summary.length > 0) {
        const message = `${"```"}\n${_formatSummaryTable(sensor, summary)}\n${"```"}`;
        await ctx.replyWithMarkdown(`_Summary for_ *${sensor.name}* _data:_\n\n` + message);
    } else {
        await ctx.replyWithMarkdown(`There is no summary for *${sensor.name}* yet`);
    }
});

bot.command("help", async ctx => {
    const {Settings, Limits, Admin} = db.data;

    const message = [
        "• To obtain real-time sensor data, use the command: /current",
        "• To view a chart displaying fresh historical sensor data, use the command: /graph",
        "• To retrieve the current sensor limits, use the command: /limits",
        "• To subscribe for notifications, use the command: /subscribe",
        "• To unsubscribe from notifications, use the command: /unsubscribe",
        [
            "• To receive a summary of the last 24 hours, use the command: _/summary <key>_",
            ...Settings.sensorParameters.map(s => `\t • To inquire about _${s.name}_: \`/summary ${s.key}\``)
        ].join("\n"),

        (ctx.message.chat.id === Admin ? [
            "• To update alerting limits, use the command: _/limit <key> <from> <to>_",
            ...Settings.sensorParameters.map(s => `\t • To update _${s.name}_ limits: \`/limit ${s.key} ${Array.isArray(Limits[s.key]) ? Limits[s.key].join(" ") : "0 " + Limits[s.key]}\``)
        ] : []).join("\n")
    ].join("\n\n")

    await ctx.replyWithMarkdown(message);
})

async function watchSensorChanges() {
    const {Settings, SensorData} = db.data;

    await FileUtils.watch(
        Settings.fileName, Settings.minRefreshInterval * 1000,
        async () => {
            const data = await readData();
            if (!data) return;

            Object.assign(SensorData, data);
            SensorData.lastUpdate = new Date().getTime();

            await db.write();
        }
    );
}

async function processSummary() {
    const {SensorData, Settings} = db.data;

    const now = new Date();
    const dateString = now.toLocaleDateString();
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

    if (Settings.summaryEnabled && SensorData.summary.sentDate !== dateString && hour >= Settings.summaryTime) {
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
                    `- *${s.name}*: ${_formatMinMaxAvg(s.key, periodSummary, s.unit, s.fraction)}`).join("\n")
            );

            console.log(new Date(), `Summary sent (${count} records)`);
        }

        SensorData.summary.sentDate = dateString;
    }

    await db.write();
}

function _minMaxAvg(key, dst, src, count) {
    if (!dst[key] || !src[key]) return;

    dst[key].max = Math.max(dst[key].max, src[key].max ?? src[key]);
    dst[key].min = Math.min(dst[key].min, src[key].min ?? src[key]);
    dst[key].avg = _calculateNextAverage(dst[key].avg ?? 0, src[key].avg ?? src[key] ?? 0, count);
}

function _calculateNextAverage(previousAverage, currentValue, n) {
    return (previousAverage * n + currentValue) / (n + 1);
}

function _formatMinMaxAvg(key, src, unit, fraction) {
    const data = src[key];
    if (!data) return "";

    return `~ ${data.avg.toFixed(fraction)} ${unit} (${data.min.toFixed(fraction)}..${data.max.toFixed(fraction)})`
}

function _formatSummaryTable({key, fraction}, history) {
    if (!history || history.length === 0) {
        return null;
    }

    const rows = new Array(history.length + 1);
    rows[0] = ["Date", "Avg.", "Min.", "Max."];

    const lengths = rows[0].map(s => s.length + 2);
    for (let i = 1; i < rows.length; i++) {
        rows[i] = [
            `${history[i - 1].date} ${history[i - 1].hour.toString().padStart(2, "0")}:00`,
            history[i - 1][key]?.avg?.toFixed(fraction) ?? "---",
            history[i - 1][key]?.min?.toFixed(fraction) ?? "---",
            history[i - 1][key]?.max?.toFixed(fraction) ?? "---",
        ]

        for (let j = 0; j < lengths.length; j++) {
            lengths[j] = Math.max(lengths[j], rows[i][j].length + 2);
        }
    }

    const _formatVerticalLine = () => `+${lengths.map(l => "".padEnd(l, "-")).join("+")}+`;
    const _formatDataLine = (row) => `|${row.map((r, i) => "".padStart(1) + r.padEnd(lengths[i] - 1)).join("|")}|`;

    const header = rows.shift();
    const result = [
        _formatVerticalLine(),
        _formatDataLine(header),
        _formatVerticalLine(),
        ...rows.map(_formatDataLine),
        _formatVerticalLine(),
    ]

    return result.join("\n");
}

async function _alertsTimeout() {
    await processAlerts();
    setTimeout(_alertsTimeout, 5000);
}

async function _summaryTimeout() {
    await processSummary();
    setTimeout(_summaryTimeout, 60000);
}

initConfig();

setTimeout(watchSensorChanges);
setTimeout(_alertsTimeout);
setTimeout(_summaryTimeout);

console.log(new Date(), "Listening...");
await bot.launch();