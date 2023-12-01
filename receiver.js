import process from "node:process";
import fs from "node:fs/promises";

import Express from "express";

const OUT_FILE = "./data.log";
const API_KEY = process.env.API_KEY;
const API_PORT = Number.parseInt(process.env.API_PORT ?? "8080");

const app = Express();

app.disable('x-powered-by');
app.use(Express.json());

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
    await fs.appendFile(OUT_FILE, Object.entries(data).map(([key, value]) =>
        `${new Date().toISOString()}\t${key}\t${value}`
    ).join("\n") + "\n");

    return res.status(200).end();
});

app.use((req, res, next) => {
    res.status(404).end("Not Found");
});

app.use((error, req, res, next) => {
    res.status(500).end("Internal Error");
});

const server = app.listen(API_PORT, () => {
    console.log(new Date(), `Sensor data server started at ${server.address().port}!`);
});