import {createSensorColorResolver, getCompactSensorName, getSensorIconMarkup} from './sensor-presentation.js';

const SPARKLINE_SCALE_CACHE = new Map();
const SPARKLINE_SCALE_SHRINK_RATE = 0.08;
const SPARKLINE_SCALE_PADDING_RATIO = 0.12;

export function formatSensorValue(series) {
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

function getSensorKey(series) {
    return series.config?.key || series.config?.dataKey || series.config?.name || '';
}

function pruneSparklineScaleCache(apiData) {
    const activeKeys = new Set((apiData || []).map(getSensorKey).filter(Boolean));
    for (const key of SPARKLINE_SCALE_CACHE.keys()) {
        if (!activeKeys.has(key)) SPARKLINE_SCALE_CACHE.delete(key);
    }
}

function getPaddedRange(min, max) {
    const range = max - min || Math.max(Math.abs(max), 1);
    const padding = range * SPARKLINE_SCALE_PADDING_RATIO;
    return {
        min: min - padding,
        max: max + padding,
    };
}

function getSparklineScale(series, values) {
    const key = getSensorKey(series);
    const actualMin = Math.min(...values);
    const actualMax = Math.max(...values);
    const target = getPaddedRange(actualMin, actualMax);
    const cached = key ? SPARKLINE_SCALE_CACHE.get(key) : null;

    if (!cached) {
        if (key) SPARKLINE_SCALE_CACHE.set(key, target);
        return target;
    }

    const next = {
        min: target.min < cached.min
            ? target.min
            : cached.min + (target.min - cached.min) * SPARKLINE_SCALE_SHRINK_RATE,
        max: target.max > cached.max
            ? target.max
            : cached.max + (target.max - cached.max) * SPARKLINE_SCALE_SHRINK_RATE,
    };

    if (key) SPARKLINE_SCALE_CACHE.set(key, next);
    return next;
}

function buildSparklinePoints(series, width = 132, height = 44) {
    const values = (series.data || [])
        .map(row => Number(row.value))
        .filter(Number.isFinite)
        .slice(-48);

    if (!values.length) return '';

    const {min, max} = getSparklineScale(series, values);
    const range = max - min || 1;
    const padding = 4;
    const chartHeight = height - padding * 2;

    if (values.length === 1) {
        const y = padding + (1 - (values[0] - min) / range) * chartHeight;
        return `0,${y.toFixed(1)} ${width},${y.toFixed(1)}`;
    }

    return values.map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = padding + (1 - (value - min) / range) * chartHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
}

function renderSparkline(series) {
    const sparkline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sparkline.classList.add('sensor-sparkline');
    sparkline.setAttribute('viewBox', '0 0 132 44');
    sparkline.setAttribute('preserveAspectRatio', 'none');
    sparkline.setAttribute('aria-hidden', 'true');

    const areaPoints = buildSparklinePoints(series);
    if (!areaPoints) return sparkline;

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    area.setAttribute('points', `0,44 ${areaPoints} 132,44`);
    area.classList.add('sensor-sparkline-area');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', areaPoints);
    line.classList.add('sensor-sparkline-line');

    sparkline.append(area, line);
    return sparkline;
}

function buildNoDataPoints(index, width = 132, height = 44) {
    const patterns = [
        [0.70, 0.48, 0.62, 0.34, 0.43, 0.30, 0.52, 0.39, 0.58, 0.50, 0.44, 0.33],
        [0.55, 0.38, 0.45, 0.66, 0.58, 0.36, 0.42, 0.31, 0.49, 0.41, 0.53, 0.35],
        [0.34, 0.42, 0.30, 0.54, 0.47, 0.61, 0.45, 0.37, 0.50, 0.28, 0.44, 0.39],
    ];
    const values = patterns[index % patterns.length];
    const padding = 5;
    const chartHeight = height - padding * 2;

    return values.map((value, valueIndex) => {
        const x = (valueIndex / (values.length - 1)) * width;
        const y = padding + value * chartHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
}

function renderNoDataSparkline(index) {
    const points = buildNoDataPoints(index);
    const sparkline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sparkline.classList.add('sensor-sparkline', 'sensor-sparkline-empty');
    sparkline.setAttribute('viewBox', '0 0 132 44');
    sparkline.setAttribute('preserveAspectRatio', 'none');
    sparkline.setAttribute('aria-label', 'No data');

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    area.setAttribute('points', `0,44 ${points} 132,44`);
    area.classList.add('sensor-sparkline-empty-area');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points);
    line.classList.add('sensor-sparkline-empty-line');

    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badge.setAttribute('x', '66');
    badge.setAttribute('y', '25');
    badge.classList.add('sensor-sparkline-empty-badge');
    badge.textContent = 'NO DATA';

    sparkline.append(area, line, badge);
    return sparkline;
}

export function renderSensorSummary(container, apiData) {
    container.classList.remove('is-loading');
    container.innerHTML = '';
    pruneSparklineScaleCache(apiData);
    if (!apiData?.length) {
        container.innerHTML = `<div class="sensor-card placeholder-card">No sensors selected</div>`;
        return;
    }

    const getSensorColor = createSensorColorResolver(apiData);
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

        if (series.data?.length) {
            right.append(renderSparkline(series));
        } else {
            const key = getSensorKey(series);
            if (key) SPARKLINE_SCALE_CACHE.delete(key);
            right.append(renderNoDataSparkline(index));
        }
        head.append(icon, text, right);
        card.append(head);
        container.appendChild(card);
    });
}

export function renderSensorCompactSummary(container, apiData) {
    container.classList.remove('is-loading');
    container.innerHTML = '';
    if (!apiData?.length) {
        container.innerHTML = `<div class="sensor-card placeholder-card">No sensors selected</div>`;
        return;
    }

    const row = document.createElement('div');
    row.className = 'sensor-compact-row';
    renderChartMiniLegend(row, apiData);
    container.appendChild(row);
}

export function renderSensorLoading(container) {
    container.classList.add('is-loading');
    container.innerHTML = `<div class="sensor-card placeholder-card loading-card shimmer">Loading sensors...</div>`;
}

export function renderChartMiniLegend(container, apiData) {
    if (!container) return;
    container.innerHTML = '';

    if (!apiData?.length) return;

    const getSensorColor = createSensorColorResolver(apiData);
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
        container.appendChild(item);
    });
}
