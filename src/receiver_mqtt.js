import fs from "node:fs/promises";
import mqtt from "mqtt";
import {JSONPreset} from "lowdb/node";
import * as ParseUtils from "./utils/parsing.js";
import process from "node:process";

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_BROKER_AUTH = process.env.MQTT_BROKER_AUTH;

const TOPICS = process.env.TOPICS.split(";").filter(v => v.length > 0);

const db = await JSONPreset('db.json', {});
if (!db.data.Settings?.fileName) throw new Error("Database not configured!");

const client = mqtt.connect(MQTT_BROKER_URL, {
    auth: MQTT_BROKER_AUTH
});

client.on('connect', () => {
    console.log('Connected to MQTT Broker');
    for (const topic of TOPICS) {
        client.subscribe(topic, (err) => {
            if (!err) {
                console.log(`Subscribed to topic: ${topic}`);
            } else {
                console.error('Subscription error:', err);
            }
        });
    }
});


client.on('message', async (topic, message) => {
    const key = topic.split("/").at(-1).toUpperCase();
    const value = message.toString();

    console.log(`Received message from topic '${topic}': ${key} - ${value}`);

    const entry = `${new Date().toISOString()}\t${key}\t${value}`;
    if (ParseUtils.isValidSensorString(entry, db.data.Settings.sensorParameters)) {
        return await fs.appendFile(db.data.Settings.fileName, entry + "\n");
    }
});

client.on('error', (err) => {
    console.error('MQTT Error:', err);
});

process.on('SIGINT', () => {
    client.end(() => {
        console.log('Disconnected from MQTT Broker');
        process.exit(0);
    });
});
