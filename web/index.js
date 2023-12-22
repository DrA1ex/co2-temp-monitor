import Chart from '../node_modules/chart.js/auto'

window.onhashchange = () => location.reload()

const params = document.location.hash.slice(1).split("&").map(h => h.split("=")).filter(p => p.length === 2);
const queryParams = new URLSearchParams(params || {});
const data = await fetch("./data/?" + queryParams).then(f => {if (f.ok) return f.json(); else throw new Error(f.statusText)});

const map = {};
for (const param of data) {
    for (const row of param.data) {
        const time = Math.round(new Date(row.time).getTime() / 1000);
        if (!map[time]) map[time] = {time: new Date(row.time)};

        Object.assign(map[time], {[param.config.key]: row.value});
    }
}

const chartData = Object.entries(map)
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);

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

clearTimeout(__global.loadingTimerId);
__global.loadingScreen.style.visibility = "collapse";

const ctx = document.getElementById('chart');
const colors = [
    "#ff8a66", "#8266ff", "#ff66ab",
    "#66adff", "#8ed571", "#cc5656"
];

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
            ...data.slice(1).reduce((p, c, i) => {
                p[`y${i + 2}`] = {
                    type: "linear",
                    position: i === 0 ? "left" : "none",
                    grid: {drawOnChartArea: false}
                }

                return p;
            }, {})
        }
    }
});