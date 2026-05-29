import {createAuthClient} from './auth-client.js';
import {createChartView} from './chart-view.js';
import {initSettingsModal, showConfigModal} from './settings-modal.js';
import {initUI} from './ui.js';
import {renderChartMiniLegend, renderSensorLoading, renderSensorSummary} from './sensor-summary.js';

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

let allSensors = [];
let selectedSensors = [];
let loadingTimer = null;
let refreshAbortController = null;
let refreshRequestId = 0;

const ui = initUI();
const auth = createAuthClient(ui);
const chartView = createChartView({
    canvas: ui.chartCanvasEl,
    cardEl: ui.chartCardEl,
    statusEl: ui.chartStatusEl,
    fullscreenBtn: ui.chartFullscreenBtn,
});

initSettingsModal();
setControlsReady(false);

ui.periodEl.addEventListener('change', () => {
    syncPeriodLabel();
    updateHashFromControls();
    refresh();
});

ui.settingsBtn.addEventListener('click', async () => {
    try {
        selectedSensors = await showConfigModal(allSensors, selectedSensors);
        updateHashFromControls();
        refresh();
    } catch (error) {
        console.log("Configuration cancelled:", error);
    }
});

ui.downloadBtn.addEventListener('click', () => {
    chartView.downloadCSV(ui.periodEl.value);
});

window.addEventListener('hashchange', () => {
    applyStateFromUrl();
    refresh();
});

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

function isLoadingVisible() {
    return ui.loadingOverlayEl?.style.opacity === '1';
}

function showLoading(text = 'Loading…') {
    clearInitialLoadingTimer();
    clearTimeout(loadingTimer);

    if (isLoadingVisible()) {
        return;
    }

    loadingTimer = setTimeout(() => {
        if (!ui.loadingOverlayEl || !ui.loadingTextEl) return;
        ui.loadingTextEl.textContent = getDelayedLoadingText(text);
        ui.loadingOverlayEl.style.pointerEvents = 'auto';
        ui.loadingOverlayEl.style.opacity = '1';
    }, 700);
}

function hideLoading() {
    clearInitialLoadingTimer();
    clearTimeout(loadingTimer);
    loadingTimer = null;
    if (!ui.loadingOverlayEl) return;
    ui.loadingOverlayEl.style.pointerEvents = 'none';
    ui.loadingOverlayEl.style.opacity = '0';
}

function setControlsReady(isReady) {
    ui.periodEl.disabled = !isReady;
    ui.settingsBtn.disabled = !isReady;
    ui.periodControlEl?.classList.toggle('is-loading', !isReady);
    ui.periodControlEl?.classList.toggle('shimmer', !isReady);
    ui.settingsBtn.classList.toggle('is-loading', !isReady);
    ui.settingsBtn.classList.toggle('shimmer', !isReady);
    ui.downloadBtn.classList.toggle('is-loading', !isReady);
    ui.downloadBtn.classList.toggle('shimmer', !isReady);
}

async function loadMeta() {
    try {
        const json = await auth.fetchJson('/meta');
        allSensors = json.sensors || [];
    } catch (error) {
        console.error('Failed to load meta:', error);
        allSensors = [];
    }
}

function populatePeriods() {
    ui.periodEl.innerHTML = '';
    Object.entries(PERIODS).forEach(([key, value]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = key;
        ui.periodEl.appendChild(option);
    });
}

function syncPeriodLabel() {
    const selectedOption = ui.periodEl.options[ui.periodEl.selectedIndex];
    ui.periodValueEl.textContent = selectedOption?.textContent || ui.periodEl.value || '';
}

function updateDataState(latestTime) {
    ui.dataStateDotEl.className = 'state-dot';

    if (!latestTime) {
        ui.dataStateTextEl.textContent = 'No Data';
        ui.dataStateDotEl.classList.add('state-dot-empty');
        return;
    }

    const ageMs = Date.now() - latestTime.getTime();
    if (ageMs >= 0 && ageMs <= 30 * 60 * 1000) {
        ui.dataStateTextEl.textContent = 'Live';
        ui.dataStateDotEl.classList.add('state-dot-live');
        return;
    }

    ui.dataStateTextEl.textContent = 'Historical';
    ui.dataStateDotEl.classList.add('state-dot-historical');
}

function buildQueryFromControls() {
    const params = new URLSearchParams();
    params.set('period', ui.periodEl.value);
    params.set('length', Math.max(2, Math.min(5000, Number(ui.lengthEl.value || 300))));
    params.set('ratio', Math.max(0, Math.min(1, Number(ui.ratioEl.value || 1))));

    const keys = selectedSensors.map(s => s.key);
    const mins = selectedSensors.map(s => s.min);
    const maxs = selectedSensors.map(s => s.max);

    if (keys.length) params.set('key', keys.join(','));
    if (mins.some(v => v !== '')) params.set('min', mins.join(','));
    if (maxs.some(v => v !== '')) params.set('max', maxs.join(','));

    return params;
}

function updateHashFromControls() {
    const hash = buildQueryFromControls().toString().replace(/%2C/g, ',');
    history.pushState(null, '', "#" + hash);
}

function getStateParams() {
    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.slice(1));

    for (const [key, value] of hashParams.entries()) {
        params.set(key, value);
    }

    return params;
}

function applyStateFromUrl() {
    const params = getStateParams();
    ui.periodEl.value = params.get('period') || ui.periodEl.value;
    syncPeriodLabel();
    ui.lengthEl.value = params.get('length') || ui.lengthEl.value;
    ui.ratioEl.value = params.get('ratio') || ui.ratioEl.value;

    const keys = (params.get('key') || '').split(',').filter(Boolean);
    if (!keys.length) return;

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

function renderEmptyState(title = 'No data available', metaLine = `Period: ${ui.periodEl.value} · Points: ${ui.lengthEl.value} · Sensors: 0`) {
    ui.downloadBtn.disabled = true;
    ui.chartTitleEl.textContent = title;
    ui.metaLineEl.textContent = metaLine;
    chartView.destroy();
    chartView.exitPseudoFullscreen();
    chartView.setState('empty', 'No data available for selected parameters.');
    renderSensorSummary(ui.sensorSummaryEl, []);
    renderChartMiniLegend(ui.chartMiniLegendEl, []);
    ui.lastUpdatedEl.textContent = 'Last updated: -';
    updateDataState(null);
}

function renderLoadingState() {
    ui.downloadBtn.disabled = true;
    renderChartMiniLegend(ui.chartMiniLegendEl, []);
    renderSensorLoading(ui.sensorSummaryEl);
    chartView.setState('loading', 'Loading chart...');
    showLoading('Loading data…');
}

function renderReadyState(orderedData, minA, maxA) {
    const latestTime = getLatestTime(orderedData);

    ui.downloadBtn.disabled = false;
    ui.chartTitleEl.textContent = 'Sensor history';
    ui.metaLineEl.textContent = `Period: ${ui.periodEl.value} · Points: ${ui.lengthEl.value} · Sensors: ${orderedData.length}`;
    ui.lastUpdatedEl.textContent = `Last updated: ${latestTime ? latestTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '-'}`;
    updateDataState(latestTime);

    renderSensorSummary(ui.sensorSummaryEl, orderedData);
    renderChartMiniLegend(ui.chartMiniLegendEl, orderedData);
    chartView.draw(orderedData, minA, maxA);
    chartView.setState('data');
}

async function fetchChartData(params, signal) {
    return auth.fetchJson(`/data?${params.toString()}`, {signal});
}

function isApiDataEmpty(apiData) {
    return !apiData || !apiData.length || apiData.every(series => !series.data?.length);
}

function getOrderedData(apiData) {
    return selectedSensors
        .map(sel => apiData.find(d => d.config.key === sel.key))
        .filter(Boolean);
}

async function refresh() {
    const requestId = ++refreshRequestId;
    refreshAbortController?.abort();
    refreshAbortController = new AbortController();

    const params = buildQueryFromControls();
    renderLoadingState();

    try {
        const apiData = await fetchChartData(params, refreshAbortController.signal);
        if (requestId !== refreshRequestId) return;

        if (isApiDataEmpty(apiData)) {
            renderEmptyState('No data available');
            return;
        }

        const orderedData = getOrderedData(apiData);
        if (!orderedData.length) {
            renderEmptyState('No sensors selected');
            return;
        }

        const minA = selectedSensors.map(s => parseFloat(s.min) || undefined);
        const maxA = selectedSensors.map(s => parseFloat(s.max) || undefined);
        renderReadyState(orderedData, minA, maxA);
    } catch (error) {
        if (error.name === 'AbortError' || requestId !== refreshRequestId) return;
        console.error('Data load error', error);
        renderEmptyState('Error loading data', error.message || String(error));
    } finally {
        if (requestId === refreshRequestId) {
            hideLoading();
            refreshAbortController = null;
        }
    }
}

function getLatestTime(seriesList) {
    return seriesList
        .flatMap(series => series.data?.slice(-1) || [])
        .map(row => new Date(row.time))
        .filter(date => !Number.isNaN(date.getTime()))
        .sort((a, b) => b - a)[0];
}

(async function init() {
    populatePeriods();
    try {
        if (!(await auth.check())) {
            await auth.requireAuth();
        }
    } catch (error) {
        console.error('Authorization check failed:', error);
        renderEmptyState('Authorization check failed', error.message || String(error));
        return;
    }

    await loadMeta();

    applyStateFromUrl();
    if (!selectedSensors.length) {
        selectedSensors = allSensors.slice(0, DEFAULT_SELECTED_LIMIT).map(s => ({
            key: s.key, name: s.name, unit: s.unit, min: '', max: ''
        }));
        updateHashFromControls();
    }

    setControlsReady(true);
    await refresh();
})();
