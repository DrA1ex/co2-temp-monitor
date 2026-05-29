import Chart from '../node_modules/chart.js/auto';
import {initUI, showConfigModal} from './ui.js';

// === Constants ===
const PERIODS = {
    "stream": "raw",
    "last 1h": "1h",
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
const DEFAULT_SELECTED_LIMIT = 4;
const CHART_COLORS = ["#2563eb", "#f59e0b", "#06b6d4", "#475569", "#16a34a", "#dc2626", "#7c3aed", "#0f766e"];
const SENSOR_COLOR_HINTS = [
    {patterns: ['co2', 'carbon'], color: '#2563eb'},
    {patterns: ['temp', 'temperature'], color: '#f59e0b'},
    {patterns: ['humid', 'humidity'], color: '#06b6d4'},
    {patterns: ['press', 'pressure', 'baro'], color: '#475569'},
];

// === Application State ===
let allSensors = [];
// Use an array of objects to maintain order and store min/max values
let selectedSensors = [];
let chartInstance = null;

const ui = initUI();

// === DOM Element References (via ui module) ===
const {
    periodEl,
    periodValueEl,
    lengthEl,
    ratioEl,
    chartTitleEl,
    metaLineEl,
    chartSkeletonEl,
    downloadBtn,
    ctx,
    sensorSummaryEl,
    lastUpdatedEl,
    dataStateDotEl,
    dataStateTextEl,
    chartFullscreenBtn,
} = ui;

const chartCardEl = document.querySelector('.chart-card');
const chartMiniLegendEl = document.getElementById('chart-mini-legend');

const FULLSCREEN_OPEN_LABEL = 'Open chart fullscreen';
const FULLSCREEN_CLOSE_LABEL = 'Close fullscreen chart';

periodEl.addEventListener('change', () => {
    syncPeriodLabel();
    updateHashFromControls();
    refresh();
});

// === Loading Overlay Helpers ===
let loadingTimer = null;

function clearInitialLoadingTimer() {
    if (window.__initialLoadingTimer) {
        clearTimeout(window.__initialLoadingTimer);
        window.__initialLoadingTimer = null;
    }
}

function getDelayedLoadingText(text) {
    if (/^loading data/i.test(text)) return 'Still loading data…';
    if (/^loading/i.test(text)) return 'Still loading…';
    return text;
}

function showLoading(text = 'Loading…') {
    clearInitialLoadingTimer();
    clearTimeout(loadingTimer);
    const startedAt = window.__pageLoadingStartedAt ?? performance.now();
    const elapsed = performance.now() - startedAt;
    const delay = Math.max(0, 700 - elapsed);
    loadingTimer = setTimeout(() => {
        window.__ui?.showLoading(getDelayedLoadingText(text));
    }, delay);
}

function hideLoading() {
    clearInitialLoadingTimer();
    clearTimeout(loadingTimer);
    loadingTimer = null;
    window.__ui?.hideLoading();
}

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

function syncPeriodLabel() {
    const selectedOption = periodEl.options[periodEl.selectedIndex];
    periodValueEl.textContent = selectedOption?.textContent || periodEl.value || '';
}

function formatDatePart(date, includeYear = false) {
    return date.toLocaleDateString([], {
        day: '2-digit',
        month: '2-digit',
        ...(includeYear ? {year: 'numeric'} : {}),
    });
}

function formatTimePart(date, includeSeconds = false) {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? {second: '2-digit'} : {}),
    });
}

function formatChartTickLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return formatTimePart(date);

    const isCurrentYear = date.getFullYear() === now.getFullYear();
    return [
        formatDatePart(date, !isCurrentYear),
        formatTimePart(date),
    ];
}

function formatFullDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString([], {day: '2-digit', month: '2-digit', year: 'numeric'})}, ${formatTimePart(date, true)}`;
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
        row.chartTime = row.time.toISOString();
        row.time = row.time.toLocaleString();
    });

    return sortedData;
}

function formatSensorValue(series) {
    const lastValue = series.data[series.data.length - 1]?.value;
    if (!Number.isFinite(lastValue)) return '?';
    return `${lastValue.toFixed(series.config.fraction)}${series.config.unit || ''}`;
}

function getSensorValueParts(series) {
    const lastValue = series.data[series.data.length - 1]?.value;
    if (!Number.isFinite(lastValue)) {
        return {value: '?', unit: ''};
    }

    return {
        value: lastValue.toFixed(series.config.fraction),
        unit: series.config.unit || '',
    };
}

function getCompactSensorName(series) {
    const name = `${series.config.key || ''} ${series.config.name || ''}`.toLowerCase();
    if (name.includes('temp')) return 'Temp';
    if (name.includes('humid')) return 'Hum';
    if (name.includes('co2')) return 'CO2';
    if (name.includes('pm_25') || name.includes('2.5')) return 'PM2.5';
    if (name.includes('pm_10') || name.includes('1.0')) return 'PM1';
    if (name.includes('pm_100') || name.includes('10.0')) return 'PM10';
    return series.config.name || series.config.key || 'Sensor';
}

function getSensorIconMarkup(series) {
    const name = `${series.config.key || ''} ${series.config.name || ''}`.toLowerCase();
    if (name.includes('co2')) {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="9" cy="12" r="3.7"/>
                <circle cx="15.5" cy="9.4" r="2.8"/>
                <circle cx="15.5" cy="14.8" r="2.8"/>
                <path d="M12.2 10.6 13 10.2"/>
                <path d="M12.2 13.4 13 13.8"/>
            </svg>
        `;
    }
    if (name.includes('temp')) {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 14.5V6.7a3 3 0 0 0-6 0v7.8a5 5 0 1 0 6 0Z"/>
                <path d="M12 8v7"/>
                <circle cx="12" cy="17" r="1.6"/>
            </svg>
        `;
    }
    if (name.includes('humid')) {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4.5S7.2 10.1 7.2 13.7a4.8 4.8 0 0 0 9.6 0C16.8 10.1 12 4.5 12 4.5Z"/>
                <path d="M10.1 14.6a2.3 2.3 0 0 0 2.6 2"/>
            </svg>
        `;
    }
    if (name.includes('press')) {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 15a6 6 0 1 1 12 0"/>
                <path d="M12 15l3-3"/>
                <path d="M8.8 15h.01"/>
                <path d="M15.2 15h.01"/>
                <path d="M12 9.2h.01"/>
            </svg>
        `;
    }
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="8.5" r="1.7"/>
            <circle cx="15" cy="8.5" r="1.7"/>
            <circle cx="9" cy="15.5" r="1.7"/>
            <circle cx="15" cy="15.5" r="1.7"/>
            <path d="M10.9 8.5h2.2"/>
            <path d="M10.9 15.5h2.2"/>
        </svg>
    `;
}

function getSensorColor(series, index) {
    const sensorText = `${series.config.key || ''} ${series.config.name || ''}`.toLowerCase();
    const match = SENSOR_COLOR_HINTS.find(({patterns}) => patterns.some(pattern => sensorText.includes(pattern)));
    return match?.color || CHART_COLORS[index % CHART_COLORS.length];
}

function updateDataState(latestTime) {
    dataStateDotEl.className = 'state-dot';

    if (!latestTime) {
        dataStateTextEl.textContent = 'No Data';
        dataStateDotEl.classList.add('state-dot-empty');
        return;
    }

    const ageMs = Date.now() - latestTime.getTime();
    if (ageMs >= 0 && ageMs <= 30 * 60 * 1000) {
        dataStateTextEl.textContent = 'Live';
        dataStateDotEl.classList.add('state-dot-live');
        return;
    }

    dataStateTextEl.textContent = 'Historical';
    dataStateDotEl.classList.add('state-dot-historical');
}

function buildSparklinePoints(series, width = 132, height = 44) {
    const values = (series.data || [])
        .map(row => Number(row.value))
        .filter(Number.isFinite)
        .slice(-48);

    if (values.length < 2) return '';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 4;
    const chartHeight = height - padding * 2;

    return values.map((value, index) => {
        const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
        const y = padding + (1 - (value - min) / range) * chartHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
}

function renderSensorSummary(apiData) {
    sensorSummaryEl.innerHTML = '';
    if (!apiData?.length) {
        sensorSummaryEl.innerHTML = `<div class="sensor-card placeholder-card">No sensors selected</div>`;
        return;
    }

    apiData.forEach((series, index) => {
        const card = document.createElement('article');
        card.className = 'sensor-card';
        card.style.setProperty('--sensor-color', getSensorColor(series, index));

        const name = series.config.name || series.config.key;
        const head = document.createElement('div');
        head.className = 'sensor-card-head';

        const icon = document.createElement('div');
        icon.className = 'sensor-icon';
        icon.innerHTML = getSensorIconMarkup(series);
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('div');
        text.className = 'sensor-text';

        const label = document.createElement('span');
        label.className = 'sensor-label';
        label.textContent = name;

        const value = document.createElement('div');
        value.className = 'sensor-value';
        const valueParts = getSensorValueParts(series);
        value.innerHTML = `<span class="sensor-value-number"></span><span class="sensor-value-unit"></span>`;
        value.querySelector('.sensor-value-number').textContent = valueParts.value;
        value.querySelector('.sensor-value-unit').textContent = valueParts.unit;

        text.append(label, value);

        const right = document.createElement('div');
        right.className = 'sensor-card-side';

        const sparkline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sparkline.classList.add('sensor-sparkline');
        sparkline.setAttribute('viewBox', '0 0 132 44');
        sparkline.setAttribute('preserveAspectRatio', 'none');
        sparkline.setAttribute('aria-hidden', 'true');

        const areaPoints = buildSparklinePoints(series);
        if (areaPoints) {
            const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            area.setAttribute('points', `0,44 ${areaPoints} 132,44`);
            area.classList.add('sensor-sparkline-area');

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            line.setAttribute('points', areaPoints);
            line.classList.add('sensor-sparkline-line');

            sparkline.append(area, line);
        }

        right.append(sparkline);
        head.append(icon, text, right);
        card.append(head);
        sensorSummaryEl.appendChild(card);
    });
}

function renderSensorLoading() {
    sensorSummaryEl.innerHTML = `<div class="sensor-card placeholder-card loading-card">Loading sensors...</div>`;
}

function renderChartMiniLegend(apiData) {
    if (!chartMiniLegendEl) return;
    chartMiniLegendEl.innerHTML = '';

    if (!apiData?.length) return;

    apiData.forEach((series, index) => {
        const item = document.createElement('div');
        item.className = 'chart-mini-legend-item';
        item.style.setProperty('--sensor-color', getSensorColor(series, index));

        const dot = document.createElement('span');
        dot.className = 'chart-mini-legend-dot';
        dot.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'chart-mini-legend-label';
        label.textContent = getCompactSensorName(series);

        const value = document.createElement('span');
        value.className = 'chart-mini-legend-value';
        value.textContent = formatSensorValue(series);

        item.append(dot, label, value);
        chartMiniLegendEl.appendChild(item);
    });
}

function showChartSkeleton() {
    if (chartSkeletonEl) chartSkeletonEl.style.display = 'grid';
}

function hideChartSkeleton() {
    if (chartSkeletonEl) chartSkeletonEl.style.display = 'none';
}

function resizeChartSoon() {
    window.setTimeout(() => chartInstance?.resize(), 60);
}

function updateFullscreenButtonState(isFullscreen) {
    if (!chartFullscreenBtn) return;
    const label = isFullscreen ? FULLSCREEN_CLOSE_LABEL : FULLSCREEN_OPEN_LABEL;
    chartFullscreenBtn.setAttribute('aria-label', label);
    chartFullscreenBtn.title = label;
}

function enterPseudoFullscreen() {
    if (!chartCardEl) return;
    chartCardEl.classList.add('is-pseudo-fullscreen');
    document.body.classList.add('chart-pseudo-fullscreen-active');
    updateFullscreenButtonState(true);
    resizeChartSoon();
}

function exitPseudoFullscreen() {
    if (!chartCardEl?.classList.contains('is-pseudo-fullscreen')) return;
    chartCardEl.classList.remove('is-pseudo-fullscreen');
    document.body.classList.remove('chart-pseudo-fullscreen-active');
    updateFullscreenButtonState(Boolean(document.fullscreenElement));
    resizeChartSoon();
}

// === Chart Drawing ===
function drawChart(apiData, suggestedMin, suggestedMax) {
    const chartData = transformData(apiData);
    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue('--text').trim() || '#12202a';
    const mutedColor = styles.getPropertyValue('--muted').trim() || '#667985';
    const gridColor = 'rgba(100, 116, 139, 0.14)';
    const isNarrowViewport = window.matchMedia('(max-width: 620px)').matches;
    const chartWidth = ctx.canvas?.clientWidth || window.innerWidth;
    const xTickLimit = Math.max(3, Math.floor(chartWidth / (isNarrowViewport ? 96 : 138)));

    const datasets = apiData.map((series, index) => ({
        label: `${series.config.name}${series.config.unit ? ` (${series.config.unit})` : ''}`,
        data: chartData,
        borderColor: getSensorColor(series, index),
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBorderWidth: 2,
        tension: 0.22,
        parsing: {xAxisKey: 'chartTime', yAxisKey: series.config.key},
        yAxisID: index === 0 ? 'y' : `y${index + 1}`,
    }));

    const extraScales = {};
    apiData.slice(1).forEach((_, index) => {
        const seriesIndex = index + 1;
        const series = apiData[seriesIndex];
        const color = getSensorColor(series, seriesIndex);
        extraScales[`y${index + 2}`] = {
            type: 'linear',
            position: "right",
            grid: {drawOnChartArea: false, tickLength: 0},
            ticks: {color, display: !isNarrowViewport, padding: 10, maxTicksLimit: 6},
            border: {color, display: !isNarrowViewport},
            title: {display: false},
            suggestedMin: suggestedMin?.[index + 1], suggestedMax: suggestedMax?.[index + 1],
        };
    });

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {datasets},
        options: {
            animation: false,
            layout: {padding: {top: 8, right: 8, bottom: 2, left: 8}},
            maintainAspectRatio: false,
            responsive: true,
            interaction: {mode: 'index', intersect: false},
            plugins: {
                legend: {
                    display: false,
                    position: 'top',
                    align: 'start',
                    labels: {
                        color: textColor,
                        boxWidth: 28,
                        boxHeight: 3,
                        usePointStyle: false,
                        padding: 24
                    }
                },
                tooltip: {
                    mode: 'nearest',
                    intersect: false,
                    backgroundColor: '#12202a',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        title: items => {
                            const value = items[0]?.raw?.chartTime || items[0]?.label;
                            return formatFullDateTime(value);
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'category',
                    ticks: {
                        autoSkip: true,
                        maxRotation: 0,
                        minRotation: 0,
                        color: mutedColor,
                        padding: 10,
                        maxTicksLimit: xTickLimit,
                        callback(value) {
                            return formatChartTickLabel(this.getLabelForValue(value));
                        },
                    },
                    grid: {display: false, tickLength: 0},
                    border: {display: false}
                },
                y: {
                    position: 'left',
                    suggestedMin: suggestedMin?.[0],
                    suggestedMax: suggestedMax?.[0],
                    grid: {color: gridColor, tickLength: 0},
                    ticks: {color: getSensorColor(apiData[0], 0), padding: 10, maxTicksLimit: 6},
                    border: {color: getSensorColor(apiData[0], 0)},
                    title: {display: false}
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
    syncPeriodLabel();
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
    chartCardEl?.classList.remove('has-data', 'is-empty');
    renderChartMiniLegend([]);
    renderSensorLoading();
    showChartSkeleton();
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
            chartCardEl?.classList.add('is-empty');
            exitPseudoFullscreen();
            hideChartSkeleton();
            renderSensorSummary([]);
            renderChartMiniLegend([]);
            lastUpdatedEl.textContent = 'Last updated: -';
            updateDataState(null);
            return;
        }
        noDataEl.style.display = 'none';

        // Filter and order data based on selectedSensors array
        const orderedData = selectedSensors
            .map(sel => apiData.find(d => d.config.key === sel.key))
            .filter(Boolean);

        if (!orderedData.length) {
            chartTitleEl.textContent = 'No sensors selected';
            metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: 0`;
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
            noDataEl.style.display = 'flex';
            chartCardEl?.classList.add('is-empty');
            exitPseudoFullscreen();
            hideChartSkeleton();
            renderSensorSummary([]);
            renderChartMiniLegend([]);
            lastUpdatedEl.textContent = 'Last updated: -';
            updateDataState(null);
            chartCardEl?.classList.remove('has-data');
            return;
        }

        const minA = selectedSensors.map(s => parseFloat(s.min) || undefined);
        const maxA = selectedSensors.map(s => parseFloat(s.max) || undefined);

        chartTitleEl.textContent = 'Sensor history';
        metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: ${orderedData.length}`;
        const latestTime = orderedData
            .flatMap(series => series.data?.slice(-1) || [])
            .map(row => new Date(row.time))
            .filter(date => !Number.isNaN(date.getTime()))
            .sort((a, b) => b - a)[0];
        lastUpdatedEl.textContent = `Last updated: ${latestTime ? latestTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '-'}`;
        updateDataState(latestTime);

        renderSensorSummary(orderedData);
        renderChartMiniLegend(orderedData);
        hideChartSkeleton();
        drawChart(orderedData, minA, maxA);
        chartCardEl?.classList.add('has-data');
    } catch (error) {
        console.error('Data load error', error);
        chartTitleEl.textContent = 'Error loading data';
        metaLineEl.textContent = error.message || String(error);
        renderSensorSummary([]);
        renderChartMiniLegend([]);
        chartCardEl?.classList.add('is-empty');
        exitPseudoFullscreen();
        hideChartSkeleton();
        lastUpdatedEl.textContent = 'Last updated: -';
        updateDataState(null);
        chartCardEl?.classList.remove('has-data');
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

chartFullscreenBtn?.addEventListener('click', async () => {
    if (!chartCardEl) return;

    if (chartCardEl.classList.contains('is-pseudo-fullscreen')) {
        exitPseudoFullscreen();
        return;
    }

    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else if (chartCardEl.requestFullscreen) {
            await chartCardEl.requestFullscreen();
        } else {
            enterPseudoFullscreen();
        }
    } catch (error) {
        console.error('Fullscreen toggle failed', error);
        enterPseudoFullscreen();
    }
});

document.addEventListener('fullscreenchange', () => {
    const isFullscreen = Boolean(document.fullscreenElement);
    if (isFullscreen) {
        exitPseudoFullscreen();
    }
    updateFullscreenButtonState(isFullscreen);
    resizeChartSoon();
});

window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        exitPseudoFullscreen();
    }
});

window.addEventListener('hashchange', () => {
    applyStateFromHash();
    refresh();
});

// === Initialization ===
(async function init() {
    populatePeriods();
    syncPeriodLabel();
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
