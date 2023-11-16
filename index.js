import Chart from './node_modules/chart.js/auto'

function* logDistribution(min, max, count, ratio = 1) {
    if (count < 2) throw new Error("Count should be greater or equals 2");
    if (min > max) [min, max] = [max, min];

    let offset = 0;
    if (min < 1) {
        offset = Math.abs(min) + 1;
        min += offset;
        max += offset;
    }

    ratio = Math.max(0, Math.min(1, ratio));
    for (let i = 0; i < count; i++) {
        // Linear distribution value between 0 and 1
        const linearValue = i / (count - 1);

        const logarithmicValue = i > 0 ? Math.log10(1 + linearValue * 9) : 0;

        const interpolatedValue = (1 - ratio) * linearValue + ratio * logarithmicValue;
        const scaledValue = min + interpolatedValue * (max - min);

        yield scaledValue - offset;
    }
}

function* invertedLogDistribution(min, max, count, ratio = 1) {
    const values = Array.from(logDistribution(min, max, count, ratio)).reverse();

    let prev = values[0];
    let last = min;
    for (const value of values) {
        const delta = (prev - value);
        yield last + delta;

        prev = value;
        last += delta;
    }
}

function aggregateAverage(data, from, to, fn) {
    if (from >= to) return fn(data[to]);

    let value = 0;
    for (let i = from; i <= to; i++) {
        value += fn(data[i]);
    }

    const length = to - from + 1;
    return value / length;
}

const tempRe = /(.*)\s+Tamb.+?(\d+\.?\d*)/
const co2Re = /(.*)\s+CntR.+?(\d+\.?\d*)/
const file = await fetch("./temp.log").then(f => f.text());

const tempData = file.split("\n")
    .filter(l => l.includes("Tamb"))
    .map(l => l.trim())
    .map(l => ({
        time: l.match(tempRe)[1].slice(0, -3),
        value: Number.parseFloat(l.match(tempRe)[2])
    }));

const co2Data = file.split("\n")
    .filter(l => l.includes("CntR"))
    .map(l => l.trim())
    .map(l => ({
        time: l.match(co2Re)[1].slice(0, -3),
        value: Number.parseFloat(l.match(co2Re)[2])
    }));

const map = {};
for (const t of tempData) {
    map[t.time] = {temperature: t.value, time: t.time, co2: 3000};
}

for (const c of co2Data) {
    map[c.time] = Object.assign(map[c.time] || {}, {co2: c.value});
}

const data = tempData.map(t => map[t.time]);

const urlSearchParams = new URLSearchParams(window.location.search);
const queryParams = Object.fromEntries(urlSearchParams.entries());
const ratio = Number.parseFloat(queryParams["ratio"] ?? "1");

const maxLength = Number.parseFloat(queryParams["length"] ?? "300");
const shrunk = [];

let i = 0;
let prevIndex;
for (let index of logDistribution(0, data.length - 1, maxLength, ratio)) {
    index = Math.round(index);
    if (prevIndex === undefined) prevIndex = index;

    shrunk[i++] = {
        temperature: aggregateAverage(data, prevIndex, index, v => v.temperature),
        co2: aggregateAverage(data, prevIndex, index, v => v.co2),
        time: data[index].time
    };

    prevIndex = index + 1;
}

const ctx = document.getElementById('chart');

new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [{
            label: "Temperature, Cº",
            data: shrunk,
            borderWidth: 2,
            pointStyle: false,
            borderColor: "#ff8a66",
            parsing: {
                xAxisKey: 'time',
                yAxisKey: 'temperature',
            },
        }, {
            label: "CO2, ppm",
            data: shrunk,
            borderWidth: 2,
            pointStyle: false,
            borderColor: "#8266ff",
            yAxisID: 'y2',
            borderDash: [5, 5],
            parsing: {
                xAxisKey: 'time',
                yAxisKey: 'co2',
            },

        }],
    },
    options: {
        responsive: true,
        plugins: {
            title: {
                display: true,
                text: `Temperature: ${map[tempData[tempData.length - 1].time].temperature.toFixed(2)} Cº, `
                    + `CO2 ${map[tempData[tempData.length - 1].time].co2.toFixed(0)} ppm`
            },
            legend: {
                display: false
            }
        },
        layout: {
            padding: 10
        },
        animation: false,
        scales: {
            y: {
                type: "linear",
                position: "right",
            },
            y2: {
                type: "linear",
                position: "left",
                grid: {drawOnChartArea: false}
            }
        }
    }
});