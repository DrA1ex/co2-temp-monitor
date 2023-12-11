import {ReadlineParser, SerialPort} from 'serialport'
import fs from "node:fs/promises";

import {JSONPreset} from "lowdb/node";
import process from "node:process";
import {isValidSensorString} from "./utils/parsing.js";
import * as ParseUtils from "./utils/parsing.js";

const SERIAL_PORT = process.env.SERIAL;

const db = await JSONPreset('db.json', {});
if (!db.data.Settings?.fileName) throw new Error("Database not configured!");

const port = new SerialPort({path: SERIAL_PORT, baudRate: 9600, autoOpen: false});

port.pipe(new ReadlineParser()).on("data", async (data) => {
    const out = `${new Date().toISOString()}\t${data.toString().trim()}`;
    console.log(out);

    if (ParseUtils.isValidSensorString(out, db.data.Settings.sensorParameters)) {
        return await fs.appendFile(db.data.Settings.fileName, out + "\n");
    }
})

console.log(`Connecting to ${SERIAL_PORT}`);
port.open(err => {
    if (err) return console.log("Unable to connect: ", err);
    console.log("Connected");
});

await new Promise((resolve, reject) => {port.on("close", reject)});