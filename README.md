# CO2/Temperature monitor

## Installation
```sh
git clone https://github.com/DrA1ex/co2-temp-monitor.git
cd ./co2-temp-monitor

npm install
```

## Data Format

Each line should contains time, data type key and value.

`<TIME> <KEY> <VALUE>`

E.g.
```
15.11.2023 20:39:08 Tamb	28.6000
15.11.2023 20:39:10 CntR	2340
15.11.2023 20:39:13 Tamb	28.5375
15.11.2023 20:39:15 CntR	2344
15.11.2023 20:39:18 Tamb	28.5375
15.11.2023 20:39:21 CntR	2338
15.11.2023 20:39:23 Tamb	28.4750
```

## Running

You should provide streaming file with sensor data according to the [Data Format](#data-format)

For exmaple, if your Monitor support HID interface, you can use [co2mon](https://github.com/dmage/co2mon) to populate data:
```sh
# Build and install co2mon according to instruction on it's GitHub page
# Then run co2mon and write stream to a file

# Also you must provide time in stream file, since co2mon doesn't provide it

# I use `ts` and `tee` tools
# For MacOS yous should instal tools first:
#     brew install moreutils

./build/co2mond/co2mond | ts '%d.%m.%Y %H:%M:%S' | tee -a ~/temp.log

# You should also provide your own log rotation or use bult-in script.
# Exampe of using a cron task:

chmod +x ./log_rotate.sh
crontab -l | { cat; echo "0 0 * * * $PWD/log_rotate.sh"; } | crontab -
```

### Web UI
```sh
# Create link to your sensor stream file
link /path/to/sensor/data_stream.log ./temp.log

# Run Web Server
npm run serve
```


![image](https://github.com/DrA1ex/co2-temp-monitor/assets/1194059/3019fe90-7a4c-42e9-a947-c2318ff9b415)


### Telegram Bot
```sh
# Create link to your sensor stream file
link /path/to/sensor/data.log ~/dev/temp_serv/temp.log

# Option 1. Run with auto restarting when app crashed
chmod +x ./monitor.sh
BOT_TOKEN=<YOUR_TOKEN_HERE> ./monitor.sh

# Option 2. Simple run
BOT_TOKEN=<YOUR_TOKEN_HERE> node ./server.js
```

#### Commands
```
/current - Get current sensor data
/graph - Get last sensor data history graph
/subscribe - Subscribe to notifications
/unsubscribe - Unsubscribe from notifications
/limits - List of current sensor data limits
/limit - Set sensor data limit
```

#### Customization
After first start, server is going to create `db.json` file. You can modify file directly to adjust some parameters

```js
{
  "Settings": {
    "alertCooldown": 90, // Cooldown for alert status change in seconds
    "temperatureKey": "Tamb", // Key of temperature parameter in sensor data file
    "co2Key": "CntR", // Key of co2 parameter in sensor data file
    "fileName": "./temp.log", // Name of sendor data file
    "alertOkPrefix": "🌿", // Prefix for OK alert
    "alertFailedPrefix": "😱😱😱" // Prefix for failing alert
  }
}
```

Also you can use telegarm API to modify alertion range using command: `/limit <key> <from> <to>`
