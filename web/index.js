import Chart from '../node_modules/chart.js/auto'

const periods = ["raw", "1d", "1w", "1m", "3m", "6m", "1y", "2y", "5y"];

async function loadData() {
    const params = new URLSearchParams(location.hash.slice(1));
    const data = await fetch("./data/?" + params)
        .then(f => { if (f.ok) return f.json(); else throw new Error(f.statusText) });

    const suggestedMin = (params.get("min") ?? "").split(",").map(v => Number.parseFloat(v)).map(v => Number.isNaN(v) ? undefined : v);
    const suggestedMax = (params.get("max") ?? "").split(",").map(v => Number.parseFloat(v)).map(v => Number.isNaN(v) ? undefined : v);

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
    }).join(", ");

    clearTimeout(__global.loadingTimerId);
    __global.loadingScreen.style.visibility = "collapse";

    const ctx = document.getElementById('chart');
    const colors = [
        "#ff8a66", "#8266ff", "#ff66ab",
        "#66adff", "#8ed571", "#cc5656"
    ];

    if (__global.chart) {
        __global.chart.destroy();
    }

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

    __global.chart = new Chart(ctx, {
        type: 'line',
        data: {datasets},
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: title
                },
                legend: {display: true}
            },
            layout: {padding: 10},
            animation: false,
            scales: {
                y: {
                    type: "linear",
                    position: "right",
                    suggestedMin: suggestedMin[0],
                    suggestedMax: suggestedMax[0]
                },
                ...data.slice(1).reduce((p, c, i) => {
                    p[`y${i + 2}`] = {
                        type: "linear",
                        position: i === 0 ? "left" : "none",
                        grid: {drawOnChartArea: false},
                        suggestedMin: suggestedMin[i + 1],
                        suggestedMax: suggestedMax[i + 1]
                    }

                    return p;
                }, {})
            }
        }
    });
}

// Handle form submit → update hash → reload chart
document.getElementById("controls-form").addEventListener("submit", e => {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set("period", document.getElementById("period").value);
    params.set("length", document.getElementById("length").value);
    params.set("ratio", document.getElementById("ratio").value);
    params.set("key", document.getElementById("keys").value);
    location.hash = params.toString();
    loadData();
});

// Fill period options
const periodSelect = document.getElementById("period");
periods.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    periodSelect.appendChild(opt);
});

// Initial load
window.addEventListener("hashchange", loadData);
await loadData();
