import fs from "node:fs/promises";
import https from "http-proxy";
import process from "node:process";

const SSL_KEY = process.env.SSL_KEY;
const SSL_CERT = process.env.SSL_CERT;

const SOURCE_ADDRESS = process.env.SOURCE_ADDRESS ?? "localhost";
const SOURCE_PORT = Number.parseInt(process.env.SOURCE_PORT ?? "8000");
const PROXY_PORT = Number.parseInt(process.env.PROXY_PORT ?? "8433");

if (!SSL_CERT || !SSL_KEY) {
    console.log("You must specify SSL_CERT and SSL_KEY env variables");
    process.exit(1);
}

const [cert, key] = await Promise.all([
    fs.readFile(SSL_CERT),
    fs.readFile(SSL_KEY),
]);

const options = {
    target: {
        host: SOURCE_ADDRESS,
        port: SOURCE_PORT
    },
    ssl: {
        cert,
        key
    }
};

const server = https.createProxyServer(options).listen(PROXY_PORT, () => {
    console.log(new Date(), `Proxy HTTPS server started at ${PROXY_PORT}!`);
});
