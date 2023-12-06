import Chart from '../node_modules/chart.js/auto'

const urlSearchParams = new URLSearchParams(window.location.search);
const data = await fetch("./data" + urlSearchParams).then(f => {if (f.ok) return f.json(); else throw new Error(f.statusText)});

const map = {};
for (const param of data) {
    for (const row of param.data) {
        if (!map[row.time]) map[row.time] = {time: new Date(row.time)};
        Object.assign(map[row.time], {[param.config.key]: row.value});
    }
}

const chartData = Object.values(map).sort((a, b) => a.time < b.time ? -1 : 1);
const lastValues = data.reduce((p, c) => {
    p[c.config.key] = c.data[0]?.value;
    return p;
}, {});

for (const row of chartData) {
    for (const key of Object.keys(lastValues)) {
        if (row[key] !== undefined) lastValues[key] = row[key];
    }

    row.time = new Date(row.time).toLocaleString();
    Object.assign(row, lastValues);
}

const title = data.map(d => {
        const lastValue = d.data[d.data.length - 1]?.value;
        return `${d.config.name}: ${Number.isFinite(lastValue) ? lastValue.toFixed(d.config.fraction) : "?"} ${d.config.unit}`
    }
).join(", ");

document.getElementById("loading-screen").style.visibility = "collapse";
const ctx = document.getElementById('chart');

const colors = ["#ff8a66", "#8266ff", "#ff66ab", "#66adff"];
const datasets = data.map((d, i) => ({
    label: `${d.config.name}, ${d.config.unit}`,
    data: chartData,
    borderWidth: 2,
    pointStyle: false,
    borderColor: colors[i % colors.length],
    yAxisID: i === 0 ? "y" : `y${i + 1}`,
    parsing: {
        xAxisKey: 'time',
        yAxisKey: d.config.key,
    },
}));

new Chart(ctx, {
    type: 'line',
    data: {datasets},
    options: {
        responsive: true,
        plugins: {
            title: {
                display: true,
                text: title
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
            },
            ...data.slice(2).reduce((p, c, i) => {
                p[`y${i + 3}`] = {
                    type: "linear",
                    position: "none",
                    grid: {drawOnChartArea: false}
                }

                return p;
            }, {})
        }
    }
});