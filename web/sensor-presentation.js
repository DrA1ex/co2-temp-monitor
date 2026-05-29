const FALLBACK_COLORS = ["#2563eb", "#f59e0b", "#06b6d4", "#475569", "#16a34a", "#dc2626", "#7c3aed", "#0f766e"];

const PRESENTATIONS = [
    {
        patterns: ['co2', 'carbon'],
        color: '#2563eb',
        compactName: 'CO2',
        icon: `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="9" cy="12" r="3.7"/>
                <circle cx="15.5" cy="9.4" r="2.8"/>
                <circle cx="15.5" cy="14.8" r="2.8"/>
                <path d="M12.2 10.6 13 10.2"/>
                <path d="M12.2 13.4 13 13.8"/>
            </svg>
        `,
    },
    {
        patterns: ['temp', 'temperature'],
        color: '#f59e0b',
        compactName: 'Temp',
        icon: `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 14.5V6.7a3 3 0 0 0-6 0v7.8a5 5 0 1 0 6 0Z"/>
                <path d="M12 8v7"/>
                <circle cx="12" cy="17" r="1.6"/>
            </svg>
        `,
    },
    {
        patterns: ['humid', 'humidity'],
        color: '#06b6d4',
        compactName: 'Hum',
        icon: `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4.5S7.2 10.1 7.2 13.7a4.8 4.8 0 0 0 9.6 0C16.8 10.1 12 4.5 12 4.5Z"/>
                <path d="M10.1 14.6a2.3 2.3 0 0 0 2.6 2"/>
            </svg>
        `,
    },
    {
        patterns: ['press', 'pressure', 'baro'],
        color: '#475569',
        icon: `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 15a6 6 0 1 1 12 0"/>
                <path d="M12 15l3-3"/>
                <path d="M8.8 15h.01"/>
                <path d="M15.2 15h.01"/>
                <path d="M12 9.2h.01"/>
            </svg>
        `,
    },
    {patterns: ['pm_100', '10.0'], compactName: 'PM10'},
    {patterns: ['pm_25', '2.5'], compactName: 'PM2.5'},
    {patterns: ['pm_10', '1.0'], compactName: 'PM1'},
];

const DEFAULT_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8.5" r="1.7"/>
        <circle cx="15" cy="8.5" r="1.7"/>
        <circle cx="9" cy="15.5" r="1.7"/>
        <circle cx="15" cy="15.5" r="1.7"/>
        <path d="M10.9 8.5h2.2"/>
        <path d="M10.9 15.5h2.2"/>
    </svg>
`;

function getSensorText(series) {
    return `${series.config.key || ''} ${series.config.name || ''}`.toLowerCase();
}

function findPresentation(series) {
    const sensorText = getSensorText(series);
    return PRESENTATIONS.find(({patterns}) => patterns.some(pattern => sensorText.includes(pattern)));
}

export function getSensorColor(series, index) {
    return findPresentation(series)?.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function getCompactSensorName(series) {
    return findPresentation(series)?.compactName || series.config.name || series.config.key || 'Sensor';
}

export function getSensorIconMarkup(series) {
    return findPresentation(series)?.icon || DEFAULT_ICON;
}
