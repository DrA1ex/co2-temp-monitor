import process from "node:process";
import fs from "node:fs/promises";
import https from "node:https";
import http from "node:http";

import Compression from "compression";
import Express from "express";

const SSL_KEY = process.env.SSL_KEY;
const SSL_CERT = process.env.SSL_CERT;

export async function startServer(app, port, fn) {
    app.disable('x-powered-by');
    app.use(Compression());
    app.use(Express.json());

    fn(app);

    app.use((req, res, next) => {
        res.status(404).end("Not Found");
    });

    app.use((error, req, res, next) => {
        res.status(500).end("Internal Error");
    });

    let server;
    if (SSL_CERT && SSL_KEY) {
        const [cert, key] = await Promise.all([
            fs.readFile(SSL_CERT),
            fs.readFile(SSL_KEY),
        ]);

        const options = {cert, key};
        server = https.createServer(options, app).listen(port, () => {
            console.log(new Date(), `HTTPS server started at ${server.address().port}!`);
        });
    } else {
        server = http.createServer(app).listen(port, () => {
            console.log(new Date(), `HTTP server started at ${server.address().port}!`);
        });
    }

    return server;
}