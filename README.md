# CO2/Temperature Monitor

## Installation
```sh
git clone https://github.com/DrA1ex/co2-temp-monitor.git
cd ./co2-temp-monitor

npm install
```

## Running
You should provide a streaming file with sensor data according to the [Data Format](#data-format).

To provide data use [ESP32](https://github.com/DrA1ex/temp-monitor-esp32) project along with `receiver` script.
```sh

# To verify request, use any string, same for sender and receiver
API_KEY=<VERIFICATION KEY>
OUT_FILE=<FILE TO WRITE>

# Opttionaly for SSL
SSL_KEY=<PATH TO SSL KEY PEM>
SSL_CERT=<PATH TO SSL CERT PEM>

node ./receiver.js
```

Receiver starts http(s) server with `POST /sensor` method.

Alternative, if your monitor supports the HID interface, you can use [co2mon](https://github.com/dmage/co2mon) to populate data:
```sh
# Build and install co2mon according to the instructions on its GitHub page.
# Then run co2mon and write the stream to a file.

# Also, you must provide timestamps in the stream file, as co2mon doesn't provide them.

# I use `ts` and `tee` tools.
# For MacOS, you should install the tools first:
#     brew install moreutils

./build/co2mond/co2mond | ts '%d.%m.%Y %H:%M:%S' | tee -a ~/temp.log

# You should also provide your own log rotation or use the built-in script.
# Example of using a cron task:

chmod +x ./log_rotate.sh
crontab -l | { cat; echo "0 0 * * * $PWD/log_rotate.sh"; } | crontab -
```

### Web UI
```sh
# Create a link to your sensor stream file
ln -s /path/to/sensor/data_stream.log ./bundle/temp.log

# Run the Web Server
npm run serve
```

![image](https://github.com/DrA1ex/co2-temp-monitor/assets/1194059/6fd804a5-86dc-45da-9894-098d852cee09)


### Telegram Bot
```sh
# Create a link to your sensor stream file
ln -s /path/to/sensor/data.log ~/dev/temp_serv/temp.log

# Option 1: Run with auto-restarting when the app crashes
chmod +x ./monitor.sh
BOT_TOKEN=<YOUR_TOKEN_HERE> ./monitor.sh

# Option 2: Simple run
BOT_TOKEN=<YOUR_TOKEN_HERE> node ./server.js
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
  "Settings": {
    // Custom parameters. You can add new or delete parameters you don't need
    sensorParameters: [
        {key: "temperature", name: "Temperature", unit: "Cº", dataKey: "Tamb"},
        {key: "co2", name: "CO2", unit: "ppm", dataKey: "CntR"},
        {key: "humidity", name: "Humidity", unit: "%", dataKey: "Hum"},
        {key: "freshness", name: "Freshness", unit: "sec"},
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

Also, you can use the Telegram API to modify the alert range using the command: `/limit <key> <from> <to>`

## Data Format
Each line should contain time, a data type key, and value in the following format:

`<TIME> <KEY> <VALUE>`

E.g.
```
15.11.2023 20:39:08 Tamb  28.6000
15.11.2023 20:39:10 CntR   2340
15.11.2023 20:39:13 Tamb   28.5375
15.11.2023 20:39:15 CntR   2344
15.11.2023 20:39:18 Tamb   28.5375
15.11.2023 20:39:21 CntR   2338
15.11.2023 20:39:23 Tamb   28.4750
```
