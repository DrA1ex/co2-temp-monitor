const DataParsingRePattern = "^(.*)\\s+$KEY\\s+?(\\d+\\.?\\d*)$";

const RegExpByKey = {};

export function parseData(lines, sensorConfig) {
    const result = {history: {}};

    let hasAnyData = false;
    for (const param of sensorConfig) {
        if (!param.dataKey) continue;

        const data = lines.filter(l => l.includes(param.dataKey))
            .map(str => getEntry(str, param.dataKey))
            .filter(entry => entry);

        if (data.length === 0) continue;

        result[param.key] = data[data.length - 1]?.value ?? 0;
        result.history[param.key] = data;
        hasAnyData = true;
    }

    if (!hasAnyData) return null;

    result.time = new Date().toLocaleString();
    return result;
}

export function isValidSensorString(str, sensorConfig) {
    return sensorConfig.some(s => getEntry(str, s.dataKey) !== null);
}

function getEntry(str, key) {
    if(!key) return null;

    if (!RegExpByKey[key]) {
        RegExpByKey[key] = new RegExp(DataParsingRePattern.replace("$KEY", key));
    }

    const re = RegExpByKey[key];
    const match = str.trim().match(re);
    if (!match) return null;

    const time = match[1];
    const value = Number.parseFloat(match && match[2]);
    if (!Number.isFinite(value)) return null;

    return {time, value}
}