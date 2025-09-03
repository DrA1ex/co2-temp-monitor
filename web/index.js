import Chart from '../node_modules/chart.js/auto';
import {initUI, showConfigModal} from './ui.js';

// === Constants ===
const PERIODS = {
    "stream": "raw",
    "las 1h": "1h",
    "last 4h": "4h",
    "last 12h": "12h",
    "yesterday": "1d",
    "last week": "1w",
    "last month": "1m",
    "3 months": "3m",
    "6 months": "6m",
    "last year": "1y",
    "2 years": "2y",
    "5 years": "5y"
};
const DEFAULT_SELECTED_LIMIT = 3;

// === Application State ===
let allSensors = [];
// Use an array of objects to maintain order and store min/max values
let selectedSensors = [];
let chartInstance = null;

const ui = initUI();

// === DOM Element References (via ui module) ===
const {periodEl, lengthEl, ratioEl, chartTitleEl, metaLineEl, downloadBtn, ctx} = ui;

periodEl.addEventListener('change', () => {
    updateHashFromControls();
    refresh();
});

// === Loading Overlay Helpers ===
const showLoading = (text = 'Loading…') => window.__ui?.showLoading(text);
const hideLoading = () => window.__ui?.hideLoading();

// === Data Fetching and Processing ===
async function loadMeta() {
    try {
        const response = await fetch('/meta');
        if (!response.ok) throw new Error('Failed to load /meta');
        const json = await response.json();
        allSensors = json.sensors || [];
    } catch (error) {
        console.error('Failed to load meta:', error);
        allSensors = [];
    }
}

function populatePeriods() {
    periodEl.innerHTML = '';
    Object.entries(PERIODS).forEach(([key, value]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = key;
        periodEl.appendChild(option);
    });
}

function transformData(apiData) {
    const timeMap = new Map();
    const prevValues = {};

    apiData.forEach(series => {
        const key = series.config.key;
        prevValues[key] = series.data[0]?.value ?? null;
        series.data.forEach(row => {
            const timestamp = Math.round(new Date(row.time).getTime() / 1000);
            if (!timeMap.has(timestamp)) {
                timeMap.set(timestamp, {time: new Date(row.time)});
            }
            timeMap.get(timestamp)[key] = row.value;
        });
    });

    const sortedData = Array.from(timeMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value);

    sortedData.forEach(row => {
        Object.keys(prevValues).forEach(key => {
            if (row[key] !== undefined) {
                prevValues[key] = row[key];
            } else {
                row[key] = prevValues[key];
            }
        });
        row.time = row.time.toLocaleString();
    });

    return sortedData;
}

// === Chart Drawing ===
function drawChart(apiData, suggestedMin, suggestedMax) {
    const chartData = transformData(apiData);
    const colors = ["#2563eb", "#ef4444", "#10b981", "#f97316", "#7c3aed", "#06b6d4", "#84cc16", "#8b5cf6"];

    const datasets = apiData.map((series, index) => ({
        label: `${series.config.name}${series.config.unit ? ` (${series.config.unit})` : ''}`,
        data: chartData,
        borderColor: colors[index % colors.length],
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        parsing: {xAxisKey: 'time', yAxisKey: series.config.key},
        yAxisID: index === 0 ? 'y' : `y${index + 1}`,
    }));

    const extraScales = {};
    apiData.slice(1).forEach((_, index) => {
        extraScales[`y${index + 2}`] = {
            type: 'linear', position: index === 0 ? "left" : "none",
            grid: {drawOnChartArea: index === 0},
            suggestedMin: suggestedMin?.[index + 1], suggestedMax: suggestedMax?.[index + 1],
        };
    });

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {datasets},
        options: {
            animation: false,
            layout: {padding: 10},
            maintainAspectRatio: false,
            plugins: {legend: {display: 'bottom'}, tooltip: {mode: 'nearest', intersect: false}},
            scales: {
                x: {type: 'category', ticks: {autoSkip: true, maxRotation: 70}, grid: {display: false}},
                y: {
                    position: 'right',
                    suggestedMin: suggestedMin?.[0],
                    suggestedMax: suggestedMax?.[0],
                    grid: {color: 'rgba(15,23,42,0.04)'}
                },
                ...extraScales,
            },
        },
    });
    chartInstance.__lastData = apiData;
}

// === CSV Download ===
function downloadCSV(apiData) {
    if (!apiData?.length) return;
    const timeline = transformData(apiData);
    const headers = ['time', ...apiData.map(series => series.config.key)];
    const lines = [headers.join(','), ...timeline.map(row =>
        [`"${row.time}"`, ...apiData.map(series => row[series.config.key] ?? '')].join(',')
    )];
    const blob = new Blob([lines.join('\n')], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `export_${periodEl.value}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// === URL Hash and Query Management ===
function buildQueryFromControls() {
    const params = new URLSearchParams();
    params.set('period', periodEl.value);
    params.set('length', Math.max(2, Math.min(5000, Number(lengthEl.value || 300))));
    params.set('ratio', Math.max(0, Math.min(1, Number(ratioEl.value || 1))));

    // Build query from the ordered selectedSensors array
    const keys = selectedSensors.map(s => s.key);
    const mins = selectedSensors.map(s => s.min);
    const maxs = selectedSensors.map(s => s.max);

    if (keys.length) params.set('key', keys.join(','));
    if (mins.some(v => v !== '')) params.set('min', mins.join(','));
    if (maxs.some(v => v !== '')) params.set('max', maxs.join(','));

    return params;
}

function updateHashFromControls() {
    location.hash = buildQueryFromControls().toString().replace(/%2C/g, ',');
}

function applyStateFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    periodEl.value = params.get('period') || periodEl.value;
    lengthEl.value = params.get('length') || lengthEl.value;
    ratioEl.value = params.get('ratio') || ratioEl.value;

    const keys = (params.get('key') || '').split(',').filter(Boolean);
    const mins = (params.get('min') || '').split(',');
    const maxs = (params.get('max') || '').split(',');

    selectedSensors = keys.map((key, index) => {
        const sensor = allSensors.find(s => s.key === key) || {key, name: key, unit: ''};
        return {
            key: sensor.key,
            name: sensor.name,
            unit: sensor.unit,
            min: mins[index] || '',
            max: maxs[index] || '',
        };
    });
}

// === Main Refresh Logic ===
async function refresh() {
    const params = buildQueryFromControls();
    showLoading('Loading data…');
    try {
        const response = await fetch(`/data?${params.toString()}`);
        if (!response.ok) throw new Error(response.statusText || 'Failed');
        const apiData = await response.json();

        const noDataEl = document.getElementById('no-data');
        if (!apiData || !apiData.length || apiData.every(s => !s.data?.length)) {
            chartTitleEl.textContent = 'No data available';
            metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: 0`;
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
            noDataEl.style.display = 'flex';
            return;
        }
        noDataEl.style.display = 'none';

        // Filter and order data based on selectedSensors array
        const orderedData = selectedSensors
            .map(sel => apiData.find(d => d.config.key === sel.key))
            .filter(Boolean);

        const minA = selectedSensors.map(s => parseFloat(s.min) || undefined);
        const maxA = selectedSensors.map(s => parseFloat(s.max) || undefined);

        const titleParts = orderedData.map(series => {
            const lastValue = series.data[series.data.length - 1]?.value;
            return `${series.config.name}: ${Number.isFinite(lastValue) ? lastValue.toFixed(series.config.fraction) : '?'}${series.config.unit || ''}`;
        });
        chartTitleEl.textContent = titleParts.join(' • ') || 'No data';
        metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: ${orderedData.length}`;

        drawChart(orderedData, minA, maxA);
    } catch (error) {
        console.error('Data load error', error);
        chartTitleEl.textContent = 'Error loading data';
        metaLineEl.textContent = error.message || String(error);
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    } finally {
        hideLoading();
    }
}

// === Event Listeners ===
ui.settingsBtn.addEventListener('click', async () => {
    try {
        // Ask the UI for the new configuration and wait for the user to finish
        // Once the user confirms, update the main application state
        selectedSensors = await showConfigModal(allSensors, selectedSensors);

        // Trigger the refresh logic with the new state
        updateHashFromControls();
        refresh();
    } catch (error) {
        // This catch block runs if the user cancels the modal (e.g., clicks backdrop)
        console.log("Configuration cancelled:", error);
    }
});

downloadBtn.addEventListener('click', () => {
    if (chartInstance?.__lastData) downloadCSV(chartInstance.__lastData);
});

window.addEventListener('hashchange', () => {
    applyStateFromHash();
    refresh();
});

// === Initialization ===
(async function init() {
    populatePeriods();
    await loadMeta();

    if (location.hash) {
        applyStateFromHash();
    } else {
        // Default state if no hash is present
        selectedSensors = allSensors.slice(0, DEFAULT_SELECTED_LIMIT).map(s => ({
            key: s.key, name: s.name, unit: s.unit, min: '', max: ''
        }));
        updateHashFromControls();
    }

    await refresh();
})();