import {createAuthClient} from './auth-client.js';
import {createChartView} from './chart-view.js';
import {closeConfigModal, initSettingsModal, showConfigModal} from './settings-modal.js';
import {initUI} from './ui.js';
import {renderChartMiniLegend, renderSensorLoading, renderSensorSummary} from './sensor-summary.js';
import {readStoredSettings, SETTINGS_LIMITS, writeStoredSettings} from './settings-storage.js';
import {createPwaManager} from './pwa.js';

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

const DEFAULT_SELECTED_LIMIT = 3;

let allSensors = [];
let selectedSensors = [];
let loadingTimer = null;
let refreshAbortController = null;
let refreshRequestId = 0;
let tailAbortController = null;
let tailTimer = null;
let tailRequestId = 0;
let toastTimer = null;
let sharedSettingsMode = false;

const ui = initUI();
const pwa = createPwaManager({
    manifestUrl: './manifest.webmanifest',
    getState: getCurrentUiState,
    applyState: applyPwaState,
    importSettings: saveSettingsToStorage,
    replaceUrl: replaceHashFromControls,
});
await pwa.updateManifest();

const auth = createAuthClient(ui, {
    onAuthRequired: handleAuthRequired,
    onAuthResolved: handleAuthResolved,
});
const chartView = createChartView({
    canvas: ui.chartCanvasEl,
    cardEl: ui.chartCardEl,
    statusEl: ui.chartStatusEl,
    fullscreenBtn: ui.chartFullscreenBtn,
});

initSettingsModal();
setControlsReady(false);

function handleAuthRequired() {
    closeConfigModal('Authorization required');
    stopTailRefresh();
}

function handleAuthResolved() {
    restartTailRefresh({showLoading: true});
}

ui.periodEl.addEventListener('change', () => {
    syncPeriodLabel();
    updateHashFromControls();
    refresh();
});

ui.settingsBtn.addEventListener('click', async () => {
    try {
        const result = await showConfigModal(allSensors, selectedSensors, {sharedSettingsMode});
        selectedSensors = result.selectedSensors;

        if (result.action === 'save-defaults' || !sharedSettingsMode) {
            saveSettingsToStorage();
            sharedSettingsMode = false;
            updateHashFromControls();
            if (result.action === 'save-defaults') {
                showToast('Settings saved as defaults');
            }
        } else {
            updateShareHashFromControls();
            showToast('Temporary settings applied');
        }

        restartTailRefresh({showLoading: true});
        refresh();
    } catch (error) {
        console.log("Configuration cancelled:", error);
    }
});

ui.shareBtn.addEventListener('click', () => {
    shareCurrentView();
});

ui.refreshBtn.addEventListener('click', () => {
    refresh();
});

window.addEventListener('hashchange', () => {
    applyStateFromUrl();
    ensureDefaultSelectedSensors();
    restartTailRefresh({showLoading: true});
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
    ui.refreshBtn.disabled = !isReady;
    ui.shareBtn.disabled = !isReady;
    ui.periodControlEl?.classList.toggle('is-loading', !isReady);
    ui.periodControlEl?.classList.toggle('shimmer', !isReady);
    ui.settingsBtn.classList.toggle('is-loading', !isReady);
    ui.settingsBtn.classList.toggle('shimmer', !isReady);
    ui.refreshBtn.classList.toggle('is-loading', !isReady);
    ui.refreshBtn.classList.toggle('shimmer', !isReady);
    ui.shareBtn.classList.toggle('is-loading', !isReady);
    ui.shareBtn.classList.toggle('shimmer', !isReady);
}

function setChartRefreshBusy(isBusy) {
    ui.refreshBtn.disabled = isBusy;
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

function updateDataState(latestTime, {historical = false} = {}) {
    ui.dataStateDotEl.className = 'state-dot';

    if (!latestTime) {
        ui.dataStateTextEl.textContent = 'No Data';
        ui.dataStateDotEl.classList.add('state-dot-empty');
        return;
    }

    if (historical) {
        ui.dataStateTextEl.textContent = 'Historical';
        ui.dataStateDotEl.classList.add('state-dot-historical');
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

function formatStatusUpdatedTime(date) {
    if (!date) return '-';

    const now = new Date();
    const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    if (date.toDateString() === now.toDateString()) return time;

    const datePart = date.toLocaleDateString([], {
        day: '2-digit',
        month: '2-digit',
        ...(date.getFullYear() !== now.getFullYear() ? {year: 'numeric'} : {}),
    });

    return `${datePart}, ${time}`;
}

function buildDataQueryFromControls() {
    const state = getCurrentUiState();
    const params = new URLSearchParams();
    params.set('period', state.period);
    params.set('length', state.length);
    params.set('ratio', state.ratio);

    const keys = state.sensors.map(s => s.key);

    if (keys.length) params.set('key', keys.join(','));

    return params;
}

function buildUrlQueryFromControls() {
    const state = getCurrentUiState();
    const params = new URLSearchParams();
    params.set('period', state.period);

    const keys = state.sensors.map(s => s.key);
    if (keys.length) params.set('key', keys.join(','));

    return params;
}

function buildShareQueryFromControls() {
    const state = getCurrentUiState();
    const params = new URLSearchParams();
    params.set('period', state.period);
    params.set('length', state.length);
    params.set('ratio', state.ratio);

    const keys = state.sensors.map(s => s.key);
    const mins = state.sensors.map(s => s.min);
    const maxs = state.sensors.map(s => s.max);

    if (keys.length) params.set('key', keys.join(','));
    if (mins.some(v => v !== '')) params.set('min', mins.join(','));
    if (maxs.some(v => v !== '')) params.set('max', maxs.join(','));
    params.set('tailMinutes', state.tailMinutes);
    params.set('tailPoints', state.tailPoints);
    params.set('tailRefresh', state.tailRefresh);

    return params;
}

function buildTailQueryFromControls() {
    const state = getCurrentUiState();
    const params = new URLSearchParams();
    params.set('minutes', state.tailMinutes);
    params.set('length', state.tailPoints);
    params.set('ratio', 1);

    const keys = state.sensors.map(s => s.key);
    if (keys.length) params.set('key', keys.join(','));

    return params;
}

function updateHashFromControls() {
    const hash = buildUrlQueryFromControls().toString().replace(/%2C/g, ',');
    history.pushState(null, '', "#" + hash);
    pwa.sync();
}

function replaceHashFromControls() {
    const hash = buildUrlQueryFromControls().toString().replace(/%2C/g, ',');
    history.replaceState(null, '', `${location.pathname}#${hash}`);
    pwa.sync();
}

function updateHashFromParams(params) {
    const hash = params.toString().replace(/%2C/g, ',');
    history.pushState(null, '', "#" + hash);
    pwa.sync();
}

async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();

    try {
        if (!document.execCommand('copy')) {
            throw new Error('Clipboard copy failed');
        }
    } finally {
        input.remove();
    }
}

function showToast(message) {
    if (!ui.toastEl) return;

    clearTimeout(toastTimer);
    ui.toastEl.textContent = message;
    ui.toastEl.setAttribute('aria-hidden', 'false');
    ui.toastEl.classList.add('is-visible');
    toastTimer = setTimeout(() => {
        ui.toastEl.classList.remove('is-visible');
        ui.toastEl.setAttribute('aria-hidden', 'true');
    }, 2200);
}

async function shareCurrentView() {
    updateShareHashFromControls();

    try {
        await copyToClipboard(location.href);
        showToast('Link copied to clipboard');
    } catch (error) {
        console.warn('Failed to copy share link:', error);
        showToast('Link is ready in the address bar');
    }
}

function updateShareHashFromControls() {
    const params = buildShareQueryFromControls();
    updateHashFromParams(params);
    sharedSettingsMode = hasCurrentSettingsOverrides(readStoredSettings());
}

function getStateParams() {
    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.slice(1));

    for (const [key, value] of hashParams.entries()) {
        params.set(key, value);
    }

    return params;
}

function getBoundedInt(value, {defaultValue, min, max}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return Number(defaultValue);
    return Math.max(min, Math.min(max, parsed));
}

function getBoundedFloat(value, {defaultValue, min, max}) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return Number(defaultValue);
    return Math.max(min, Math.min(max, parsed));
}

function normalizeOptionalNumber(value) {
    if (value === undefined || value === null || value === '') return '';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : '';
}

function normalizeSensorState(sensor) {
    return {
        key: sensor.key,
        name: sensor.name,
        unit: sensor.unit,
        min: normalizeOptionalNumber(sensor.min),
        max: normalizeOptionalNumber(sensor.max),
    };
}

function getCurrentUiState() {
    return {
        period: ui.periodEl.value,
        length: getBoundedInt(ui.lengthEl.value, SETTINGS_LIMITS.length),
        ratio: getBoundedFloat(ui.ratioEl.value, SETTINGS_LIMITS.ratio),
        tailMinutes: getBoundedInt(ui.tailMinutesEl.value, SETTINGS_LIMITS.tailMinutes),
        tailPoints: getBoundedInt(ui.tailPointsEl.value, SETTINGS_LIMITS.tailPoints),
        tailRefresh: getBoundedInt(ui.tailRefreshEl.value, SETTINGS_LIMITS.tailRefresh),
        sensors: selectedSensors.map(normalizeSensorState),
    };
}

function getSensorStateFromKey(key, {min, max} = {}, storedSettings = readStoredSettings()) {
    const sensor = allSensors.find(s => s.key === key) || {key, name: key, unit: ''};
    const storedLimits = storedSettings.limits[key] || {};
    return normalizeSensorState({
        key: sensor.key,
        name: sensor.name,
        unit: sensor.unit,
        min: min ?? storedLimits.min ?? '',
        max: max ?? storedLimits.max ?? '',
    });
}

function hasCurrentSettingsOverrides(storedSettings) {
    const state = getCurrentUiState();

    if (state.length !== Number(storedSettings.length)) {
        return true;
    }
    if (state.tailMinutes !== Number(storedSettings.tailMinutes)) {
        return true;
    }
    if (state.tailPoints !== Number(storedSettings.tailPoints)) {
        return true;
    }
    if (state.tailRefresh !== Number(storedSettings.tailRefresh)) {
        return true;
    }

    if (Math.abs(state.ratio - Number(storedSettings.ratio)) > Number.EPSILON) return true;

    return state.sensors.some(sensor => {
        const storedLimits = storedSettings.limits[sensor.key] || {};
        return sensor.min !== (storedLimits.min || '')
            || sensor.max !== (storedLimits.max || '');
    });
}

function applyStateFromUrl() {
    const params = getStateParams();
    const storedSettings = readStoredSettings();

    ui.periodEl.value = params.get('period') || ui.periodEl.value;
    syncPeriodLabel();
    ui.lengthEl.value = params.get('length') || storedSettings.length || ui.lengthEl.value;
    ui.ratioEl.value = params.get('ratio') || storedSettings.ratio || ui.ratioEl.value;
    ui.tailMinutesEl.value = params.get('tailMinutes') || storedSettings.tailMinutes || ui.tailMinutesEl.value;
    ui.tailPointsEl.value = params.get('tailPoints') || storedSettings.tailPoints || ui.tailPointsEl.value;
    ui.tailRefreshEl.value = params.get('tailRefresh') || storedSettings.tailRefresh || ui.tailRefreshEl.value;

    const keys = (params.get('key') || '').split(',').filter(Boolean);
    if (!keys.length) {
        selectedSensors = [];
        sharedSettingsMode = hasCurrentSettingsOverrides(storedSettings);
        return;
    }

    const mins = (params.get('min') || '').split(',');
    const maxs = (params.get('max') || '').split(',');
    const hasMinOverrides = params.has('min');
    const hasMaxOverrides = params.has('max');

    selectedSensors = keys.map((key, index) => {
        const storedLimits = storedSettings.limits[key] || {};
        return getSensorStateFromKey(key, {
            min: hasMinOverrides ? (mins[index] || '') : (storedLimits.min || ''),
            max: hasMaxOverrides ? (maxs[index] || '') : (storedLimits.max || ''),
        }, storedSettings);
    });

    sharedSettingsMode = hasCurrentSettingsOverrides(storedSettings);
}

function applyStoredLimitsToSensors(sensors) {
    const {limits} = readStoredSettings();
    return sensors.map(sensor => ({
        ...sensor,
        min: limits[sensor.key]?.min || sensor.min || '',
        max: limits[sensor.key]?.max || sensor.max || '',
    }));
}

function saveSettingsToStorage() {
    const state = getCurrentUiState();
    writeStoredSettings({
        ...state,
        selectedSensors: state.sensors,
    });
}

function applyPwaState(state) {
    const storedSettings = readStoredSettings();
    ui.periodEl.value = state.period ?? ui.periodEl.value;
    syncPeriodLabel();
    ui.lengthEl.value = state.length ?? storedSettings.length ?? ui.lengthEl.value;
    ui.ratioEl.value = state.ratio ?? storedSettings.ratio ?? ui.ratioEl.value;
    ui.tailMinutesEl.value = state.tailMinutes ?? storedSettings.tailMinutes ?? ui.tailMinutesEl.value;
    ui.tailPointsEl.value = state.tailPoints ?? storedSettings.tailPoints ?? ui.tailPointsEl.value;
    ui.tailRefreshEl.value = state.tailRefresh ?? storedSettings.tailRefresh ?? ui.tailRefreshEl.value;

    const sensors = Array.isArray(state.sensors)
        ? state.sensors
        : (state.keys || []).map(key => ({key}));
    selectedSensors = sensors
        .filter(sensor => sensor?.key)
        .map(sensor => getSensorStateFromKey(sensor.key, {
            min: sensor.min,
            max: sensor.max,
        }, storedSettings));
    sharedSettingsMode = false;
}

function getDefaultSelectedSensors() {
    return applyStoredLimitsToSensors(allSensors.slice(0, DEFAULT_SELECTED_LIMIT).map(s => ({
        key: s.key, name: s.name, unit: s.unit, min: '', max: ''
    })));
}

function ensureDefaultSelectedSensors() {
    if (selectedSensors.length) return false;
    selectedSensors = getDefaultSelectedSensors();
    updateHashFromControls();
    return true;
}

function renderEmptyState(title = 'No data available', metaLine = null) {
    const state = getCurrentUiState();
    ui.chartTitleEl.textContent = title;
    ui.metaLineEl.textContent = metaLine || `Period: ${state.period} · Points: ${state.length} · Sensors: 0`;
    chartView.destroy();
    chartView.exitPseudoFullscreen();
    chartView.setState('empty', 'No data available for selected parameters.');
}

function renderLoadingState() {
    chartView.setState('loading', 'Loading chart...');
    showLoading('Loading data…');
}

function renderReadyState(orderedData, minA, maxA) {
    const state = getCurrentUiState();
    ui.chartTitleEl.textContent = 'Sensor history';
    ui.metaLineEl.textContent = `Period: ${state.period} · Points: ${state.length} · Sensors: ${orderedData.length}`;

    chartView.draw(orderedData, minA, maxA);
    chartView.setState('data');
}

async function fetchChartData(params, signal) {
    return auth.fetchJson(`/data?${params.toString()}`, {signal});
}

async function fetchTailData(params, signal) {
    return auth.fetchJson(`/tail?${params.toString()}`, {signal});
}

function isApiDataEmpty(apiData) {
    return !apiData || !apiData.length || apiData.every(series => !series.data?.length);
}

function getOrderedData(apiData) {
    return selectedSensors
        .map(sel => apiData.find(d => d.config.key === sel.key))
        .filter(Boolean);
}

function normalizeTailResponse(response) {
    return Array.isArray(response)
        ? {historical: false, series: response}
        : {historical: Boolean(response?.historical), series: response?.series || []};
}

function renderTailState(response) {
    ui.deviceStatusEl?.classList.remove('is-loading', 'shimmer');

    const tail = normalizeTailResponse(response);
    const orderedData = getOrderedData(tail.series);
    if (!orderedData.length) {
        renderSensorSummary(ui.sensorSummaryEl, []);
        renderChartMiniLegend(ui.chartMiniLegendEl, []);
        ui.lastUpdatedEl.textContent = 'Updated: -';
        updateDataState(null);
        return;
    }

    const latestTime = getLatestTime(orderedData);
    renderSensorSummary(ui.sensorSummaryEl, orderedData);
    renderChartMiniLegend(ui.chartMiniLegendEl, orderedData);
    ui.lastUpdatedEl.textContent = `Updated: ${formatStatusUpdatedTime(latestTime)}`;
    updateDataState(latestTime, {historical: tail.historical});
}

async function refreshTail({showLoading = false} = {}) {
    const requestId = ++tailRequestId;
    tailAbortController?.abort();
    tailAbortController = new AbortController();

    if (!selectedSensors.length) {
        renderTailState([]);
        return;
    }

    if (showLoading) {
        ui.deviceStatusEl?.classList.add('is-loading', 'shimmer');
        renderSensorLoading(ui.sensorSummaryEl);
        renderChartMiniLegend(ui.chartMiniLegendEl, []);
    }

    try {
        const apiData = await fetchTailData(buildTailQueryFromControls(), tailAbortController.signal);
        if (requestId !== tailRequestId) return;
        renderTailState(apiData);
    } catch (error) {
        if (error.name === 'AbortError' || requestId !== tailRequestId) return;
        console.error('Tail load error', error);
    } finally {
        if (requestId === tailRequestId) {
            tailAbortController = null;
        }
    }
}

function startTailRefresh() {
    const state = getCurrentUiState();
    clearInterval(tailTimer);
    tailTimer = setInterval(() => refreshTail(), state.tailRefresh * 1000);
}

function stopTailRefresh() {
    clearInterval(tailTimer);
    tailTimer = null;
}

function restartTailRefresh({showLoading = false} = {}) {
    stopTailRefresh();
    const promise = refreshTail({showLoading});
    startTailRefresh();
    return promise;
}

async function refresh() {
    const requestId = ++refreshRequestId;
    refreshAbortController?.abort();
    refreshAbortController = new AbortController();

    const state = getCurrentUiState();
    const params = buildDataQueryFromControls();
    setChartRefreshBusy(true);
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

        const minA = state.sensors.map(s => parseFloat(s.min) || undefined);
        const maxA = state.sensors.map(s => parseFloat(s.max) || undefined);
        renderReadyState(orderedData, minA, maxA);
    } catch (error) {
        if (error.name === 'AbortError' || requestId !== refreshRequestId) return;
        console.error('Data load error', error);
        renderEmptyState('Error loading data', error.message || String(error));
    } finally {
        if (requestId === refreshRequestId) {
            hideLoading();
            setChartRefreshBusy(false);
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
    await loadMeta();

    applyStateFromUrl();
    pwa.normalizeLaunchState();
    ensureDefaultSelectedSensors();
    pwa.sync();

    setControlsReady(true);
    await Promise.all([
        restartTailRefresh({showLoading: true}),
        refresh(),
    ]);
})();
