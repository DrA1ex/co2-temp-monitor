import process from "node:process";
import {JSONPreset} from "lowdb/node";
import Express from "express";

import * as DataUtils from "./utils/data.js";
import * as FileUtils from "./utils/file.js";
import * as ParseUtils from "./utils/parsing.js";
import * as WebUtils from "./utils/web.js";

const API_PORT = Number.parseInt(process.env.API_PORT ?? "8080");
const db = await JSONPreset("db.json", {});

if (!db.data.Settings?.fileName) {
    throw new Error("Database not configured!");
}

const app = Express();

// Periods (in seconds)
const PERIOD_SPANS = {
    "1d": 1 * 24 * 60 * 60,
    "1w": 7 * 24 * 60 * 60,
    "1m": 30 * 24 * 60 * 60,
    "3m": 90 * 24 * 60 * 60,
    "6m": 180 * 24 * 60 * 60,
    "1y": 365 * 24 * 60 * 60,
    "2y": 730 * 24 * 60 * 60,
    "5y": 5 * 365 * 24 * 60 * 60,
};

// Aggregate file mapping
async function getAggregateFile(period, today) {
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    let dir, prefix;
    switch (period) {
        case "1d":
            dir = "./logs/5m";
            prefix = "agg_5m_";
            break;
        case "1w":
            dir = "./logs/30m";
            prefix = "agg_30m_";
            break;
        case "1m":
        case "3m":
        case "6m":
            dir = "./logs/2h";
            prefix = "agg_2h_";
            break;
        case "1y":
        case "2y":
            dir = "./logs/12h";
            prefix = "agg_12h_";
            break;
        case "5y":
            dir = "./logs/1w";
            prefix = "agg_1w_";
            break;
        default:
            return null;
    }

    const expectedFile = `${dir}/${prefix}${dateStr}.log`;
    if (await FileUtils.fileExists(expectedFile)) return expectedFile;

    // If the expected file doesn't exist, find the most recent file
    const files = await FileUtils.listFiles(dir);
    const matchingFiles = files
        .filter(f => f.startsWith(prefix) && f.endsWith(".log"))
        .sort((a, b) => {
            const dateA = a.slice(prefix.length, -4); // Extract date part (yyyy-mm-dd)
            const dateB = b.slice(prefix.length, -4);
            return dateB.localeCompare(dateA); // Sort descending
        });

    if (matchingFiles.length === 0) {
        return null; // No matching files found
    }

    return `${dir}/${matchingFiles[0]}`; // Return the most recent file
}

await WebUtils.startServer(app, API_PORT, () => {
    const {Settings} = db.data;

    app.get("/data", async (req, res) => {
        try {
            const period = req.query["period"]?.toString().toLowerCase();
            const validPeriods = [
                "raw",
                ...Object.keys(PERIOD_SPANS),
            ];

            if (period && !validPeriods.includes(period)) {
                return res
                    .status(400)
                    .json({
                        error: `Invalid period. Use: ${validPeriods.join(", ")}`,
                    })
                    .end();
            }

            const ratio = Math.max(
                0,
                Math.min(1, Number.parseFloat(req.query["ratio"] ?? "1"))
            );

            const maxLength = Math.max(
                2,
                Math.min(5000, Number.parseInt(req.query["length"] ?? "300"))
            );

            const filterKeys = ((k) => (k ? k.split(",") : null))(req.query["key"]);

            const startDate = new Date();
            if (period === "1d") {
                startDate.setDate(startDate.getDate() - 1);
                startDate.setHours(23, 59, 59, 999);
            }

            let dataFile;
            if (period && period !== "raw") {
                dataFile = await getAggregateFile(period, startDate);
            } else {
                dataFile = Settings.fileName;
            }

            if (!dataFile) {
                return res
                    .status(400)
                    .json({error: `No file mapping found for period ${period}`})
                    .end();
            }

            let fileContent;
            try {
                fileContent = await FileUtils.readFileText(dataFile);
            } catch (err) {
                console.error(`Failed to read file ${dataFile}:`, err.message);
                return res.status(200).json([]).end(); // return empty dataset if file missing
            }

            const parsed = ParseUtils.parseData(
                fileContent.split("\n"),
                Settings.sensorParameters
            );

            const result = [];
            for (const config of Settings.sensorParameters) {
                if (!config.dataKey || (filterKeys && !filterKeys.includes(config.key)))
                    continue;

                let entries = parsed.history[config.key] || [];

                // filter by time span if aggregated
                if (period && period !== "raw") {
                    const span = PERIOD_SPANS[period];
                    entries = entries.filter(
                        (e) => startDate - new Date(e.time).getTime() <= span * 1000
                    );
                }

                // shrink result
                const shrunk = DataUtils.shrinkData(
                    entries,
                    maxLength,
                    ratio,
                    DataUtils.logDistribution,
                    (v) => v.value
                );

                result.push({config, data: shrunk});
            }

            res.status(200).json(result).end();
        } catch (err) {
            console.error("Error in /data:", err);
            res.status(500).json({error: "Internal server error"}).end();
        }
    });

    app.get('/meta', (req, res) => {
        try {
            const {Settings} = db.data;
            if (!Settings?.sensorParameters) {
                return res.status(404).json({error: 'No sensor metadata configured'});
            }
            // Return array of sensors — we ship only needed fields
            const sensors = Settings.sensorParameters.filter(s => s.dataKey).map(s => ({
                key: s.key,
                name: s.name,
                unit: s.unit,
                fraction: s.fraction ?? 2,
                dataKey: s.dataKey
            }));
            res.status(200).json({sensors});
        } catch (err) {
            console.error('/meta error', err);
            res.status(500).json({error: 'Internal error'});
        }
    });

    app.use(Express.static("bundle"));
});
