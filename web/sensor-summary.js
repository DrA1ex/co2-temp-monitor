const CHART_COLORS = ["#2563eb", "#f59e0b", "#06b6d4", "#475569", "#16a34a", "#dc2626", "#7c3aed", "#0f766e"];
const SENSOR_COLOR_HINTS = [
    {patterns: ['co2', 'carbon'], color: '#2563eb'},
    {patterns: ['temp', 'temperature'], color: '#f59e0b'},
    {patterns: ['humid', 'humidity'], color: '#06b6d4'},
    {patterns: ['press', 'pressure', 'baro'], color: '#475569'},
];

export function getSensorColor(series, index) {
    const sensorText = `${series.config.key || ''} ${series.config.name || ''}`.toLowerCase();
    const match = SENSOR_COLOR_HINTS.find(({patterns}) => patterns.some(pattern => sensorText.includes(pattern)));
    return match?.color || CHART_COLORS[index % CHART_COLORS.length];
}

export function formatSensorValue(series) {
    const lastValue = series.data[series.data.length - 1]?.value;
    if (!Number.isFinite(lastValue)) return '?';
    return `${lastValue.toFixed(series.config.fraction)}${series.config.unit || ''}`;
}

export function getCompactSensorName(series) {
    const name = `${series.config.key || ''} ${series.config.name || ''}`.toLowerCase();
    if (name.includes('temp')) return 'Temp';
    if (name.includes('humid')) return 'Hum';
    if (name.includes('co2')) return 'CO2';
    if (name.includes('pm_25') || name.includes('2.5')) return 'PM2.5';
    if (name.includes('pm_10') || name.includes('1.0')) return 'PM1';
    if (name.includes('pm_100') || name.includes('10.0')) return 'PM10';
    return series.config.name || series.config.key || 'Sensor';
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
