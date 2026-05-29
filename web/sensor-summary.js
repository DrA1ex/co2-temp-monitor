import {createSensorColorResolver, getCompactSensorName, getSensorIconMarkup} from './sensor-presentation.js';

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

export function renderSensorSummary(container, apiData) {
    container.classList.remove('is-loading');
    container.innerHTML = '';
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
        container.appendChild(card);
    });
}

export function renderSensorLoading(container) {
    container.classList.add('is-loading');
    container.innerHTML = `<div class="sensor-card placeholder-card loading-card">Loading sensors...</div>`;
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
