// bundle/index.js
import Chart from '../node_modules/chart.js/auto';

// === Configuration ===
const PERIODS = ["raw","1d","1w","1m","3m","6m","1y","2y","5y"];
const DEFAULT_SELECTED_LIMIT = 6;

// UI elements
const periodEl = document.getElementById('period');
const lengthEl = document.getElementById('length');
const ratioEl = document.getElementById('ratio');
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

let sensors = []; // meta from /meta
let sensorMap = {};
let selected = new Set();
let chartInstance = null;

// show/hide loading
function showLoading(text = 'Loading…') {
    loadingText.textContent = text;
    loadingOverlay.style.pointerEvents = 'auto';
    loadingOverlay.style.opacity = '1';
}
function hideLoading() {
    loadingOverlay.style.pointerEvents = 'none';
    loadingOverlay.style.opacity = '0';
}

// === meta load ===
async function loadMeta() {
    try {
        const r = await fetch('/meta');
        if (!r.ok) throw new Error('Failed to load /meta');
        const json = await r.json();
        sensors = json.sensors || [];
        sensorMap = Object.fromEntries(sensors.map(s => [s.key, s]));
    } catch (err) {
        console.error('Failed to load meta:', err);
        sensors = [];
        sensorMap = {};
    }
    populateModalTags();
}

// populate period select
function populatePeriods() {
    periodEl.innerHTML = '';
    for (const p of PERIODS) {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = p;
        periodEl.appendChild(o);
    }
}

// modal tag cloud population
function populateModalTags(filter = '') {
    modalTagCloud.innerHTML = '';
    const q = (filter || '').toLowerCase().trim();
    const visible = sensors
        .filter(s => !q || (s.name || s.key).toLowerCase().includes(q) || (s.key || '').toLowerCase().includes(q))
        .sort((a,b)=> (a.name||a.key).localeCompare(b.name||b.key));
    for (const s of visible) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag' + (selected.has(s.key) ? ' selected' : '');
        btn.dataset.key = s.key;
        btn.innerText = s.name ? `${s.name} ${s.unit ? '· ' + s.unit : ''}` : s.key;
        btn.addEventListener('click', () => {
            if (selected.has(s.key)) selected.delete(s.key);
            else selected.add(s.key);
            btn.classList.toggle('selected', selected.has(s.key));
        });
        modalTagCloud.appendChild(btn);
    }
}

// modal controls
sensorsBtn.addEventListener('click', () => {
    modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false');
    modalSearch.value = '';
    populateModalTags();
});
modalClose.addEventListener('click', () => {
    closeModal();
});
modalSelectAll.addEventListener('click', () => {
    for (const s of sensors) selected.add(s.key);
    populateModalTags(modalSearch.value || '');
});
modalClear.addEventListener('click', () => {
    selected.clear();
    populateModalTags(modalSearch.value || '');
});
modalSearch.addEventListener('input', (e)=> populateModalTags(e.target.value));

// close modal on backdrop click
modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeModal();
});
function closeModal() {
    modal.style.display = 'none'; modal.setAttribute('aria-hidden','true');
    // sync selected into url hash param 'key'
    updateHashFromControls();
}

// Build query from controls (and hash)
function buildQueryParams() {
    const params = new URLSearchParams();
    params.set('period', periodEl.value);
    params.set('length', String(Math.max(2, Math.min(5000, Number(lengthEl.value || 300)))));
    params.set('ratio', String(Math.max(0, Math.min(1, Number(ratioEl.value || 1)))));
    const keys = Array.from(selected);
    if (keys.length) params.set('key', keys.join(','));
    return params;
}

// Update location.hash from controls (so URL is shareable)
function updateHashFromControls() {
    const params = buildQueryParams();
    location.hash = params.toString();
}

// Parse suggestedMin/Max arrays from params (supports from URL hash)
function parseSuggested(params) {
    const parseArray = (s) => {
        if (!s) return [];
        return s.split(",").map(v => {
            const n = Number.parseFloat(v);
            return Number.isNaN(n) ? undefined : n;
        });
    };
    const minA = parseArray(params.get("min") ?? "");
    const maxA = parseArray(params.get("max") ?? "");
    return { minA, maxA };
}

// Transform API data -> chart-friendly array (x as date string)
function transformData(apiData) {
    // Build time-indexed map (unix seconds)
    const map = new Map();
    const lastValues = {};
    for (const series of apiData) {
        const key = series.config.key;
        lastValues[key] = series.data[0]?.value ?? null;
        for (const row of series.data) {
            const t = Math.round(new Date(row.time).getTime() / 1000);
            if (!map.has(t)) map.set(t, { time: new Date(row.time) });
            map.get(t)[key] = row.value;
        }
    }
    const sorted = Array.from(map.entries()).sort((a,b)=>a[0]-b[0]).map(([,v]) => v);
    for (const row of sorted) {
        for (const k of Object.keys(lastValues)) {
            if (row[k] !== undefined) lastValues[k] = row[k];
            else row[k] = lastValues[k];
        }
        // convert time to string once (we won't use time scale)
        row.time = new Date(row.time).toLocaleString();
    }
    return sorted;
}

// Draw chart using category x-axis (date strings)
function drawChart(apiData, suggestedMin, suggestedMax) {
    const chartData = transformData(apiData);
    const colors = ["#2563eb","#ef4444","#10b981","#f97316","#7c3aed","#06b6d4","#84cc16","#8b5cf6"];

    const datasets = apiData.map((s, i) => ({
        label: `${s.config.name}${s.config.unit ? ' ('+s.config.unit+')' : ''}`,
        data: chartData,
        borderColor: colors[i % colors.length],
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        parsing: { xAxisKey: 'time', yAxisKey: s.config.key },
        yAxisID: i === 0 ? 'y' : `y${i+1}`,
    }));

    const extraScales = {};
    apiData.slice(1).forEach((s, idx) => {
        const axisId = `y${idx+2}`;
        extraScales[axisId] = {
            type: 'linear',
            display: apiData.length <= 4,
            position: idx % 2 === 0 ? 'left' : 'right',
            grid: { drawOnChartArea: idx === 0 },
            suggestedMin: (suggestedMin && suggestedMin[idx+1] !== undefined) ? suggestedMin[idx+1] : undefined,
            suggestedMax: (suggestedMax && suggestedMax[idx+1] !== undefined) ? suggestedMax[idx+1] : undefined,
        };
    });

    // primary axis suggested bounds
    const primarySuggestedMin = (suggestedMin && suggestedMin[0] !== undefined) ? suggestedMin[0] : undefined;
    const primarySuggestedMax = (suggestedMax && suggestedMax[0] !== undefined) ? suggestedMax[0] : undefined;

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            animation: false, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'nearest', intersect: false } },
            scales: {
                x: {
                    type: 'category',
                    ticks: { autoSkip: true, maxTicksLimit: 20 },
                    grid: { display: false }
                },
                y: {
                    position: 'right',
                    suggestedMin: primarySuggestedMin,
                    suggestedMax: primarySuggestedMax,
                    grid: { color: 'rgba(15,23,42,0.04)' }
                },
                ...extraScales
            }
        }
    });

    // store last response for CSV
    chartInstance.__lastData = apiData;
}

// Download CSV
function downloadCSV(apiData) {
    if (!apiData || !apiData.length) return;
    const timeline = transformData(apiData);
    const headers = ['time', ...apiData.map(s => s.config.key)];
    const lines = [headers.join(',')];
    for (const row of timeline) {
        const vals = [ `"${row.time}"`, ...apiData.map(s => (row[s.config.key] !== undefined ? row[s.config.key] : '')) ];
        lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_${periodEl.value}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Main refresh: fetch /data and draw
async function refresh() {
    const params = buildQueryFromHash(); // respect URL hash if present
    showLoading('Loading data…');
    try {
        const resp = await fetch('/data?' + params.toString());
        if (!resp.ok) throw new Error(resp.statusText || 'Failed');
        const apiData = await resp.json();

        // if no sensors selected, pick a default subset (first DEFAULT_SELECTED_LIMIT)
        if (!selected.size) {
            selected = new Set((apiData || []).slice(0, DEFAULT_SELECTED_LIMIT).map(s => s.config.key));
        }

        // ensure we only display selected sensors (filter apiData by selected keys)
        let filtered = apiData.filter(s => selected.size === 0 ? true : selected.has(s.config.key));
        // Keep order consistent with selected or meta order:
        if (selected.size) {
            const order = Array.from(selected);
            filtered = order.map(k => filtered.find(s => s.config.key === k)).filter(Boolean);
        }

        // parse suggested min/max from params
        const { minA, maxA } = parseSuggested(params);

        // update title & meta
        const titleParts = filtered.map(s => {
            const last = s.data[s.data.length-1]?.value;
            return `${s.config.name}: ${Number.isFinite(last) ? last.toFixed(s.config.fraction) : '?' } ${s.config.unit||''}`;
        });
        chartTitleEl.textContent = titleParts.join(' • ') || 'No data';
        metaLineEl.textContent = `Period: ${periodEl.value} · Points: ${lengthEl.value} · Sensors: ${filtered.length}`;

        drawChart(filtered, minA, maxA);
        hideLoading();
    } catch (err) {
        hideLoading();
        console.error('Data load error', err);
        chartTitleEl.textContent = 'Error loading data';
        metaLineEl.textContent = err.message || String(err);
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    }
}

// Build query from URL hash or controls. Priority: hash (so sharing works)
function buildQueryFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    // if no period in hash, use controls to build one and update hash
    if (!params.get('period')) {
        const built = buildQueryFromControls();
        location.hash = built.toString();
        return built;
    }
    // sync controls from hash values
    periodEl.value = params.get('period') || periodEl.value;
    lengthEl.value = params.get('length') || lengthEl.value;
    ratioEl.value = params.get('ratio') || ratioEl.value;
    const keys = params.get('key');
    if (keys) {
        selected = new Set(keys.split(',').filter(Boolean));
    }
    return params;
}

function buildQueryFromControls() {
    const params = new URLSearchParams();
    params.set('period', periodEl.value);
    params.set('length', String(Math.max(2, Math.min(5000, Number(lengthEl.value || 300)))));
    params.set('ratio', String(Math.max(0, Math.min(1, Number(ratioEl.value || 1)))));
    const keys = Array.from(selected);
    if (keys.length) params.set('key', keys.join(','));
    return params;
}

// events
updateBtn.addEventListener('click', () => {
    updateHashFromControls();
    refresh();
});
downloadBtn.addEventListener('click', () => {
    if (chartInstance && chartInstance.__lastData) downloadCSV(chartInstance.__lastData);
});

// initialize + load meta
(async function init() {
    populatePeriods();
    await loadMeta();
    // default select first few
    if (sensors && sensors.length && selected.size === 0) {
        for (const s of sensors.slice(0, DEFAULT_SELECTED_LIMIT)) selected.add(s.key);
    }
    // if hash exists, reflect it
    const urlParams = new URLSearchParams(location.hash.slice(1));
    if (urlParams.get('period')) {
        periodEl.value = urlParams.get('period');
        lengthEl.value = urlParams.get('length') || lengthEl.value;
        ratioEl.value = urlParams.get('ratio') || ratioEl.value;
        const keys = urlParams.get('key');
        if (keys) {
            selected = new Set(keys.split(',').filter(Boolean));
        }
    } else {
        // set hash from current controls
        updateHashFromControls();
    }
    // first fetch
    await refresh();
})();

// keyboard: press 's' to open sensors modal
window.addEventListener('keydown', (e) => {
    if (e.key === 's' && document.activeElement.tagName !== 'INPUT') {
        modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false');
        modalSearch.focus();
        populateModalTags();
    }
});
