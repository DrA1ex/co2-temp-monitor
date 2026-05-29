export function initUI() {
    return {
        periodEl: document.getElementById('period'),
        periodValueEl: document.getElementById('period-value'),
        lengthEl: document.getElementById('length'),
        ratioEl: document.getElementById('ratio'),
        chartTitleEl: document.getElementById('chart-title'),
        metaLineEl: document.getElementById('meta-line'),
        chartStatusEl: document.getElementById('chart-status'),
        sensorSummaryEl: document.getElementById('sensor-summary'),
        lastUpdatedEl: document.getElementById('last-updated'),
        dataStateDotEl: document.getElementById('data-state-dot'),
        dataStateTextEl: document.getElementById('data-state-text'),
        downloadBtn: document.getElementById('download'),
        chartFullscreenBtn: document.getElementById('chart-fullscreen'),
        chartCanvasEl: document.getElementById('chart'),
        chartCardEl: document.querySelector('.chart-card'),
        chartMiniLegendEl: document.getElementById('chart-mini-legend'),
        loadingOverlayEl: document.getElementById('loading-overlay'),
        loadingTextEl: document.getElementById('loading-text'),
        settingsBtn: document.getElementById('settings-btn'),
    };
}
