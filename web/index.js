// index.js (app logic)
// Keep Chart import at top for bundlers
import Chart from '../node_modules/chart.js/auto';
import {initUI} from './ui.js';

// === Constants ===
const PERIODS = ["raw", "1d", "1w", "1m", "3m", "6m", "1y", "2y", "5y"];
const DEFAULT_SELECTED_LIMIT = 3;

// application state
let sensors = [];
let selected = new Set();
let chartInstance = null;

// initialize UI and get references
const ui = initUI({
    onSensorToggle: (key, nowSelected) => {
        if (nowSelected) selected.add(key); else selected.delete(key);
    },
    onModalClose: () => {
        // save new parameters into hash and refresh chart
        updateHashFromControls();
        refresh();
    },
});

// references to DOM elements via ui
const periodEl = ui.periodEl;
const lengthEl = ui.lengthEl;
const ratioEl = ui.ratioEl;
const minEl = ui.minEl;
const maxEl = ui.maxEl;
const updateBtn = null; // update button removed from appbar; refresh happens via settings Done or hash change
const chartTitleEl = ui.chartTitleEl;
const metaLineEl = ui.metaLineEl;
const downloadBtn = ui.downloadBtn;
const modal = ui.modal;
const modalTagCloud = ui.modalTagCloud;
const modalClose = ui.modalClose;
const ctx = ui.ctx;

periodEl.addEventListener('change', () => {
    updateHashFromControls();
    refresh();
});

// === Loading overlay ===
function showLoading(text = 'Loading…') {
    if (window.__ui?.showLoading) return window.__ui.showLoading(text);
    const loadingText = document.getElementById('loading-text');
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingText) loadingText.textContent = text;
    if (loadingOverlay) {
        loadingOverlay.style.pointerEvents = 'auto';
        loadingOverlay.style.opacity = '1';
    }
}

function hideLoading() {
    if (window.__ui?.hideLoading) return window.__ui.hideLoading();
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.pointerEvents = 'none';
        loadingOverlay.style.opacity = '0';
    }
}

// === Meta and Modal ===
async function loadMeta() {
    try {
        const response = await fetch('/meta');
        if (!response.ok) throw new Error('Failed to load /meta');
        const json = await response.json();
        sensors = json.sensors || [];
    } catch (error) {
        console.error('Failed to load meta:', error);
        sensors = [];
    }
    // initial populate of modal tag cloud
    ui.populateModalTags(sensors, selected);
}

function populatePeriods() {
    periodEl.innerHTML = '';
    PERIODS.forEach(period => {
        const option = document.createElement('option');
        option.value = period;
        option.textContent = period;
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
        const axisId = `y${index + 2}`;
        extraScales[axisId] = {
            type: 'linear',
            position: index === 0 ? "left" : "none",
            grid: {drawOnChartArea: index === 0},
            suggestedMin: suggestedMin?.[index + 1],
            suggestedMax: suggestedMax?.[index + 1],
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
                x: {
                    type: 'category',
                    ticks: {autoSkip: true, maxRotation: 70},
                    grid: {display: false},
                },
                y: {
                    position: 'right',
                    suggestedMin: suggestedMin?.[0],
                    suggestedMax: suggestedMax?.[0],
                    grid: {color: 'rgba(15,23,42,0.04)'},
                },
                ...extraScales,
            },
        },
    });

    chartInstance.__lastData = apiData;
}

function downloadCSV(apiData) {
    if (!apiData?.length) return;

    const timeline = transformData(apiData);
    const headers = ['time', ...apiData.map(series => series.config.key)];
    const lines = [headers.join(',')];

    timeline.forEach(row => {
        const values = [`"${row.time}"`, ...apiData.map(series => row[series.config.key] ?? '')];
        lines.push(values.join(','));
    });

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

// === Query and Hash Management ===
function buildQueryFromControls() {
    const params = new URLSearchParams();
    params.set('period', periodEl.value);
    params.set('length', Math.max(2, Math.min(5000, Number(lengthEl.value || 300))));
    params.set('ratio', Math.max(0, Math.min(1, Number(ratioEl.value || 1))));
    const minValue = minEl.value.trim();
    const maxValue = maxEl.value.trim();
    if (minValue) params.set('min', minValue);
    if (maxValue) params.set('max', maxValue);
    const keys = Array.from(selected);
    if (keys.length) params.set('key', keys.join(','));
    return params;
}

function updateHashFromControls() {
    let queryString = buildQueryFromControls().toString();
    queryString = queryString.replace(/%252C/gi, ',').replace(/%2C/gi, ',');
    location.hash = queryString;
}

function buildQueryFromHash() {
    let params = new URLSearchParams(location.hash.slice(1));
    if (!params.get('period')) {
        updateHashFromControls();
        params = new URLSearchParams(location.hash.slice(1));
    } else {
        periodEl.value = params.get('period') || periodEl.value;
        lengthEl.value = params.get('length') || lengthEl.value;
        ratioEl.value = params.get('ratio') || ratioEl.value;
        minEl.value = params.get('min') || '';
        maxEl.value = params.get('max') || '';
        const keys = params.get('key');
        if (keys) selected = new Set(keys.split(',').filter(Boolean));
    }
    return params;
}

function parseSuggested(params) {
    const parseArray = str => (str ? str.split(',').map(v => {
        const num = Number.parseFloat(v);
        return Number.isNaN(num) ? undefined : num;
    }) : []);
    return {
        minA: parseArray(params.get('min')),
        maxA: parseArray(params.get('max')),
    };
}

// === Refresh Data ===
async function refresh() {
    const params = buildQueryFromHash();
    showLoading('Loading data…');
    try {
        const response = await fetch(`/data?${params.toString()}`);
        if (!response.ok) throw new Error(response.statusText || 'Failed');
        let apiData = await response.json();

        const noDataEl = document.getElementById('no-data');
        if (!apiData || !apiData.length || apiData.every(s => !s.data || !s.data.length)) {
            chartTitleEl.textContent = 'No data available';
            metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: 0`;

            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }

            noDataEl.style.display = 'flex';  // show overlay
            return;
        }

        // if data is available → ensure overlay hidden
        noDataEl.style.display = 'none';

        if (!selected.size) {
            selected = new Set(apiData.slice(0, DEFAULT_SELECTED_LIMIT).map(series => series.config.key));
        }

        let filteredData = apiData.filter(series => !selected.size || selected.has(series.config.key));
        if (selected.size) {
            const order = Array.from(selected);
            filteredData = order.map(key => filteredData.find(series => series.config.key === key)).filter(Boolean);
        }

        const {minA, maxA} = parseSuggested(params);

        const titleParts = filteredData.map(series => {
            const lastValue = series.data[series.data.length - 1]?.value;
            return `${series.config.name}: ${Number.isFinite(lastValue) ? lastValue.toFixed(series.config.fraction) : '?'}${series.config.unit ? ` ${series.config.unit}` : ''}`;
        });
        chartTitleEl.textContent = titleParts.join(' • ') || 'No data';
        metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: ${filteredData.length}`;

        drawChart(filteredData, minA, maxA);
        ui.populateModalTags(sensors, selected);
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
downloadBtn.addEventListener('click', () => {
    if (chartInstance?.__lastData) downloadCSV(chartInstance.__lastData);
});

window.addEventListener('hashchange', () => {
    // when user changes URL hash manually, re-read and refresh
    buildQueryFromHash();
    refresh();
});

// === Initialization ===
(async function init() {
    populatePeriods();
    await loadMeta();

    const urlParams = new URLSearchParams(location.hash.slice(1));
    if (sensors.length && !selected.size && !urlParams.get('key')) {
        sensors.slice(0, DEFAULT_SELECTED_LIMIT).forEach(sensor => selected.add(sensor.key));
    }
    if (urlParams.size) {
        periodEl.value = urlParams.get('period') || periodEl.value;
        lengthEl.value = urlParams.get('length') || lengthEl.value;
        ratioEl.value = urlParams.get('ratio') || ratioEl.value;
        minEl.value = urlParams.get('min') || '';
        maxEl.value = urlParams.get('max') || '';
        const keys = urlParams.get('key');
        if (keys) selected = new Set(keys.split(',').filter(Boolean));
    } else {
        updateHashFromControls();
    }
    // render modal tags to reflect initial selection
    ui.populateModalTags(sensors, selected);
    await refresh();
})();
