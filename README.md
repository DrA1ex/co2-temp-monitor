# CO2/Temperature Monitor

## Installation
```sh
git clone https://github.com/DrA1ex/co2-temp-monitor.git
cd ./co2-temp-monitor

npm install
```

## Data receiving
You should provide a streaming file with sensor data according to the [Data Format](#data-format).

### ESP32

To provide data use [ESP32](https://github.com/DrA1ex/temp-monitor-esp32) project along with `receiver` script.
```sh

# To verify request, use any string, same for sender and receiver
API_KEY=<VERIFICATION KEY>
OUT_FILE=<FILE TO WRITE>

# Configure port
API_PORT=8080
# You may want to increase default keep-alive timeout to reduce sending latency
API_KEEP_ALIVE_TIMEOUT=60000

# Optionally for SSL
SSL_KEY=<PATH TO SSL KEY PEM>
SSL_CERT=<PATH TO SSL CERT PEM>

# Run receiver server
node ./src/receiver.js
```

Receiver starts http(s) server with `POST /sensor` method.


You should also provide your own log rotation or use the built-in script.
```sh
# Example of using a cron task:
chmod +x ./log_rotate.sh
crontab -l | { cat; echo "0 0 * * * export BASEDIR=/path/to/data; $PWD/log_rotate.sh"; } | crontab -
```

### Serial Port

You can use the Serial Port Receiver to collect the data. The receiver will monitor the port and write all data to a file, which can be read by the chart server and a Telegram bot.

```sh
SERIAL=/dev/<DEVICE_ID> node ./src/serial.js
```

Please replace `<DEVICE_ID>` with the appropriate identifier for your device.

### HID

Alternative, if your monitor supports the HID interface, you can use [co2mon](https://github.com/dmage/co2mon) to populate data:
```sh
# Build and install co2mon according to the instructions on its GitHub page.
# Then run co2mon and write the stream to a file.

# Also, you must provide timestamp (ISO) in the stream file, as co2mon doesn't provide them.

# I use `ts` and `tee` tools.
# For MacOS, you should install the tools first:
#     brew install moreutils

./build/co2mond/co2mond | ts "%Y-%m-%dT%H:%M:%S%z" | tee -a ~/temp.log
```

### MQTT

You can read data from MQTT topic(s).

```sh
# Specify the MQTT topics you want to subscribe to, separated by semicolons (;)
TOPICS="device1/sensor/co2;device1/sensor/temp;device1/sensor/humidity"

# Set the MQTT broker URL. Note that it supports different protocols (mqtts included, see node.js lib `mqtt`)
MQTT_BROKER_URL=mqtt://example.com:1234

# If authentication is required, provide the username and password
MQTT_BROKER_AUTH="user:pass" 

# Run the data receiver
node ./src/receiver_mqtt.js
```

## Web UI (Chart server)
```sh
# Create a symbolic link to your sensor stream file
ln -s /path/to/sensor/data_stream.log ./temp.log

# Prepare the bundle
npm run bundle

# Configure port
API_PORT=8080

# Option A: Run an HTTP server
node ./src/chart.js

# Option B: Run an HTTPS server
# Generate a self-signed SSL certificate if you don't have one
mkdir certs
openssl genrsa -out certs/key.pem
openssl req -new -key certs/key.pem -out certs/csr.pem
openssl x509 -req -days 9999 -in certs/csr.pem -signkey certs/key.pem -out certs/cert.pem

SSL_KEY=./certs/key.pem
SSL_CERT=./certs/cert.pem

# Run the web server with SSL
node ./src/chart.js
```

![image](https://github.com/DrA1ex/co2-temp-monitor/assets/1194059/6fd804a5-86dc-45da-9894-098d852cee09)

### Parameters
To customize chart, you can use the following hash parameters:

|    Key   |    Type    |     Description      |
|----------|------------|----------------------|
|  ratio   |   float   | 0 for linear scale, 1 for logarithmic scale. You can set values in between. |
|  length  |    int    | Number of sensor data samples to retrieve. |
|   key    |    string[] (comma separated)   | Filter for sensor keys. |
|  span    |    int    | filtering interval in seconds |

Example: `/#key=co2,fan&ratio=0&length=1000&span=3600`


## Telegram Bot
```sh
# Create a link to your sensor stream file
ln -s /path/to/sensor/data_stream.log ./temp.log

# For /graph command you should install prerequrenments:
# See for details: https://www.npmjs.com/package/canvas

# For MacOS:
# brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman
# For Ubuntu:
# sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Option 1: Run with auto-restarting when the app crashes
chmod +x ./monitor.sh
BOT_TOKEN=<YOUR_TOKEN_HERE> ./monitor.sh

# Option 2: Simple run
BOT_TOKEN=<YOUR_TOKEN_HERE> node ./src/server.js
```

#### Commands
```
/current - Get current sensor data
/graph - Get last sensor data history graph
/summary - Get summary of sensor data for last 24 hour
/subscribe - Subscribe to notifications
/unsubscribe - Unsubscribe from notifications
/limits - List of current sensor data limits
/limit - Set sensor data limit
/help - Print help
```

#### Customization
After the first start, the server is going to create a `db.json` file. You can modify the file directly to adjust some parameters.

```js
{
  Settings: {
    // Custom parameters. You can add new or delete parameters you don't need
    sensorParameters: [
        {key: "temperature", name: "Temperature", unit: "Cº", fraction: 2, dataKey: "Tamb"},
        {key: "co2", name: "CO2", unit: "ppm", fraction: 0, dataKey: "CntR"},
        {key: "humidity", name: "Humidity", unit: "%", fraction: 1, dataKey: "Hum"},
        {key: "freshness", name: "Freshness", unit: "sec", fraction: 0},
    ],
    minRefreshInterval: 1, // Minimum refresh time interval
    historyLength: 1000, // History samples to store (used in chart generation)
    alertCooldown: 1.5 * 60, // Cooldown for alert status change in seconds
    alertForcingInterval: 10 * 60, // Force resend alert interval in seconds
    fileName: "./temp.log", // Name of the sensor data file
    alertOkPrefix: "🌿", // Prefix for OK alert
    alertFailedPrefix: "😱😱😱",  // Prefix for failing alert
    notifyLimitsChanged: true, // Notfiy subscribers when limits changed
    summaryEnabled: true, // Send every day sensor data summary
    summaryTime: 9, // Summary send hour
    summaryPeriod: [23, 9], // Summary period, hours (range: [from, to))
    graphSize: [80, 30], // Size of the graph (columns x lines)
  }
}
```

Also, you can use the telegram bot to modify the alert range using the command: `/limit <key> <from> <to>`


## Data Format

Each line should adhere to the following format:

```
<ISO-8601-DATETIME> <DATA-KEY> <VALUE>\n
```

Where:
- **ISO-8601-DATETIME**: Represents the timestamp in the ISO 8601 format, for example, `2023-12-06T22:43:40Z`.
- **DATA-KEY**: Corresponds to the specific type of data being recorded.
- **VALUE**: Denotes the recorded floating-point value.
- **\n**: Denotes the line ending (EOL, new line).

To parse the data line, the following regular expression is used:
```
^(.*)\s+$KEY.+?(\d+\.?\d*)$
```

### Data example:
```
2023-12-06T22:43:40Z     Tamb    28.6000
2023-12-06T22:43:41Z     CntR    2340
2023-12-06T22:43:41Z     Hum     48
```


## PM2 Deployment Guide

This guide allows you to configure deployment via PM2 to make it easier. Follow these steps to configure deployment.

### Step 1: Create `ecosystem.json`

Create a file named `ecosystem.json` in the root directory of your project. Replace the placeholders with your actual values. This file will define your application configurations.

```json
{
  "apps": [
    {
      "name": "bot",
      "script": "./src/server.js",
      "env": {
        "BOT_TOKEN": "<BOT-TOKEN>"
      }
    },
    {
      "name": "receiver",
      "script": "./src/receiver.js",
      "env": {
        "API_KEY": "<API-KEY>",
        "API_PORT": "8080",
        "SSL_CERT": "./certs/cert.pem",
        "SSL_KEY": "./certs/key.pem"
      }
    },
    {
      "name": "receiver_mqtt",
      "script": "./src/receiver_mqtt.js",
      "env": {
        "MQTT_BROKER_AUTH": "<USER>:<PASS>",
        "MQTT_BROKER_URL": "mqtts://<host>:<port>",
        "TOPICS": "topic1;topic2;topic3>
      }
    },
    {
      "name": "chart",
      "script": "./src/chart.js",
      "env": {
        "API_PORT": "8081",
        "SSL_CERT": "./certs/cert.pem",
        "SSL_KEY": "./certs/key.pem"
      }
    }
  ],
  "deploy": {
    "production": {
      "user": "<SSH-USERNAME>",
      "host": "<REMOTE-HOST>",
      "ref": "origin/main",
      "repo": "https://github.com/DrA1ex/co2-temp-monitor.git",
      "path": "/opt/co2-temp-monitor",
      "post-deploy": "npm install && npm run bundle && pm2 startOrRestart ecosystem.json --env production"
    }
  }
}
```

### Step 2: Configure SSL Certificates on Remote Server

Place SSL certificates on the remote server, or generate self-signed cerrtificate using the following commands:

```sh
mkdir certs
openssl genrsa -out certs/key.pem
openssl req -new -key certs/key.pem -out certs/csr.pem
openssl x509 -req -days 9999 -in certs/csr.pem -signkey certs/key.pem -out certs/cert.pem
```

### Step 3: Setup PM2 and Deploy

Install PM2 globally and set up the environment (if not done before). Then deploy and start the servers using PM2 deploy.

```sh
# Install PM2 globally
sudo npm install -g pm2

# Setup environment (once or when ecosystem.json changed)
pm2 deploy production setup

# Deploy and start servers
pm2 deploy production
```
