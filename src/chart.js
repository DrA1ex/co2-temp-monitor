import process from "node:process";
import {JSONPreset} from 'lowdb/node';
import Express from "express";

import * as DataUtils from "./utils/data.js";
import * as FileUtils from "./utils/file.js";
import * as ParseUtils from "./utils/parsing.js";
import * as WebUtils from "./utils/web.js";

const API_PORT = Number.parseInt(process.env.API_PORT ?? "8080");

const db = await JSONPreset('db.json', {});
if (!db.data.Settings?.fileName) throw new Error("Database not configured!");

const app = Express();

await WebUtils.startServer(app, API_PORT, () => {
    const {Settings} = db.data;

    app.get("/data", async (req, res) => {
        const data = await FileUtils.readFileText(Settings.fileName);
        const parsed = ParseUtils.parseData(data.split("\n"), Settings.sensorParameters);

        const ratio = Math.max(0, Math.min(1,
            Number.parseFloat(req.query["ratio"] ?? "1"))
        );

        const maxLength = Math.max(2, Math.min(5000,
            Number.parseInt(req.query["length"] ?? "300"))
        );

        const filterSpan = Math.max(60, Number.parseInt(req.query["span"]));
        const filterKey = req.query["key"];

        if (!Number.isFinite(ratio) || !Number.isFinite(maxLength)) return res.status(400).end();

        const result = [];
        for (const config of Settings.sensorParameters) {
            if (!config.dataKey || filterKey && config.key !== filterKey) continue;

            let entries = parsed.history[config.key] || [];
            if (Number.isFinite(filterSpan)) {
                const now = new Date().getTime();
                entries = entries.filter(e => (now - new Date(e.time).getTime()) / 1000 < filterSpan);
            }

            const shrunk = DataUtils.shrinkData(entries, maxLength, ratio, DataUtils.logDistribution, v => v.value);
            result.push({config, data: shrunk});
        }

        res.status(200).json(result).end();
    });

    app.use(Express.static("bundle"));
});