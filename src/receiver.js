import process from "node:process";
import fs from "node:fs/promises";
import Express from "express";

import * as WebUtils from "./utils/web.js";
import {JSONPreset} from "lowdb/node";

const db = await JSONPreset('db.json', {});
if (!db.data.Settings?.fileName) throw new Error("Database not configured!");

const API_KEY = process.env.API_KEY;
const API_PORT = Number.parseInt(process.env.API_PORT ?? "8080");
const API_KEEP_ALIVE_TIMEOUT = Number.parseInt(process.env.API_KEEP_ALIVE_TIMEOUT ?? "35000");

const app = Express();
const server = await WebUtils.startServer(app, API_PORT, () => {
    const {Settings} = db.data;

    app.post("/sensor", async (req, res) => {
        const key = req.headers["api-key"];
        if (key !== API_KEY) {
            console.log(new Date(), "Sensor data: Bad API key");
            return res.status(403).end();
        }

        if (!req.is("json")) {
            console.log(new Date(), "Sensor data: Bad body");
            return res.status(400).end();
        }

        const data = req.body;
        await fs.appendFile(Settings.fileName, Object.entries(data)
            .filter(([, value]) => Number.isFinite(value))
            .map(([key, value]) =>
                `${new Date().toISOString()}\t${key}\t${value}`
            ).join("\n") + "\n");

        return res.status(200).end();
    });
});

server.keepAliveTimeout = API_KEEP_ALIVE_TIMEOUT;
server.headersTimeout = API_KEEP_ALIVE_TIMEOUT + 5000;