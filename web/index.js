// bundle/index.js
import Chart from '../node_modules/chart.js/auto';

// === Constants ===
const PERIODS = ["raw", "1d", "1w", "1m", "3m", "6m", "1y", "2y", "5y"];
const DEFAULT_SELECTED_LIMIT = 3;

// === UI Elements ===
const periodEl = document.getElementById('period');
const lengthEl = document.getElementById('length');
const ratioEl = document.getElementById('ratio');
const minEl = document.getElementById('min');
const maxEl = document.getElementById('max');
const updateBtn = document.getElementById('update');
const sensorsBtn = document.getElementById('sensors-btn');

const modal = document.getElementById('modal');
const modalTagCloud = document.getElementById('modal-tag-cloud');
const modalSearch = document.getElementById('modal-search');
const modalClose = document.getElementById('modal-close');
const modalSelectAll = document.getElementById('modal-select-all');
const modalClear = document.getElementById('modal-clear');

const chartTitleEl = document.getElementById('chart-title');
const metaLineEl = document.getElementById('meta-line');
const downloadBtn = document.getElementById('download');

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const ctx = document.getElementById('chart');

let sensors = [];
let selected = new Set();
let chartInstance = null;

// === Loading Overlay ===
function showLoading(text = 'Loading…') {
    loadingText.textContent = text;
    loadingOverlay.style.pointerEvents = 'auto';
    loadingOverlay.style.opacity = '1';
}

function hideLoading() {
    loadingOverlay.style.pointerEvents = 'none';
    loadingOverlay.style.opacity = '0';
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
    populateModalTags();
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

function populateModalTags(filter = '') {
    modalTagCloud.innerHTML = '';
    const query = filter.toLowerCase().trim();
    const visibleSensors = sensors
        .filter(sensor => !query || (sensor.name || sensor.key).toLowerCase().includes(query) || sensor.key.toLowerCase().includes(query))
        .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));

    visibleSensors.forEach(sensor => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tag${selected.has(sensor.key) ? ' selected' : ''}`;
        button.dataset.key = sensor.key;
        button.textContent = sensor.name ? `${sensor.name}${sensor.unit ? ` · ${sensor.unit}` : ''}` : sensor.key;
        button.addEventListener('click', () => {
            if (selected.has(sensor.key)) {
                selected.delete(sensor.key);
            } else {
                selected.add(sensor.key);
            }
            button.classList.toggle('selected', selected.has(sensor.key));
        });
        modalTagCloud.appendChild(button);
    });
}

function closeModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    updateHashFromControls();
}

// === Data Transformation and Charting ===
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
sensorsBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modalSearch.value = '';
    populateModalTags();
});

modalClose.addEventListener('click', closeModal);

modalSelectAll.addEventListener('click', () => {
    sensors.forEach(sensor => selected.add(sensor.key));
    populateModalTags(modalSearch.value);
});

modalClear.addEventListener('click', () => {
    selected.clear();
    populateModalTags(modalSearch.value);
});

modalSearch.addEventListener('input', event => populateModalTags(event.target.value));

modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
});

updateBtn.addEventListener('click', () => {
    updateHashFromControls();
    refresh();
});

downloadBtn.addEventListener('click', () => {
    if (chartInstance?.__lastData) downloadCSV(chartInstance.__lastData);
});

window.addEventListener('keydown', event => {
    if (event.key === 's' && document.activeElement.tagName !== 'INPUT') {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        modalSearch.focus();
        populateModalTags();
    }
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
    await refresh();
})();