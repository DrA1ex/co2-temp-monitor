const DataParsingRePattern = "^(.*)\\s+$KEY.+?(\\d+\\.?\\d*)$";

export function parseData(lines, sensorConfig) {
    const result = {history: {}};
    for (const param of sensorConfig) {
        if (!param.dataKey) continue;

        const re = new RegExp(DataParsingRePattern.replace("$KEY", param.dataKey));
        const data = lines.filter(l => l.includes(param.dataKey))
            .map(l => {
                    const match = l.trim().match(re);
                    if (!match) return null;

                    const time = match[1];
                    const value = Number.parseFloat(match && match[2]);
                    if (!Number.isFinite(value)) return null;

                    return {time, value}
                }
            ).filter(entry => entry);

        result[param.key] = data[data.length - 1]?.value ?? 0;
        result.history[param.key] = data;
    }

    result.time = new Date().toLocaleString();
    return result;
}