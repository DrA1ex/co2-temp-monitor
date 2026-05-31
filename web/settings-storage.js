const STORAGE_KEY = 'co2-temp-monitor:chart-settings';

const DEFAULT_SETTINGS = {
    length: '300',
    ratio: '1',
    limits: {},
};

function readRawSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.warn('Failed to read settings from localStorage:', error);
        return {};
    }
}

function writeRawSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn('Failed to write settings to localStorage:', error);
    }
}

function normalizeNumberString(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return String(Math.max(min, Math.min(max, parsed)));
}

function normalizeOptionalNumberString(value) {
    if (value === undefined || value === null || value === '') return '';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : '';
}

function normalizeLimits(limits) {
    if (!limits || typeof limits !== 'object') return {};

    return Object.fromEntries(
        Object.entries(limits)
            .map(([key, value]) => [
                key,
                {
                    min: normalizeOptionalNumberString(value?.min),
                    max: normalizeOptionalNumberString(value?.max),
                },
            ])
    );
}

export function readStoredSettings() {
    const stored = readRawSettings();
    return {
        length: normalizeNumberString(stored.length, DEFAULT_SETTINGS.length, 2, 5000),
        ratio: normalizeNumberString(stored.ratio, DEFAULT_SETTINGS.ratio, 0, 1),
        limits: normalizeLimits(stored.limits),
    };
}

export function readStoredSensorLimits(key) {
    return readStoredSettings().limits[key] || {min: '', max: ''};
}

export function writeStoredSettings({length, ratio, selectedSensors}) {
    const previous = readStoredSettings();
    const next = {
        ...previous,
        length: normalizeNumberString(length, DEFAULT_SETTINGS.length, 2, 5000),
        ratio: normalizeNumberString(ratio, DEFAULT_SETTINGS.ratio, 0, 1),
        limits: {
            ...previous.limits,
        },
    };

    selectedSensors.forEach(sensor => {
        next.limits[sensor.key] = {
            min: normalizeOptionalNumberString(sensor.min),
            max: normalizeOptionalNumberString(sensor.max),
        };
    });

    writeRawSettings(next);
}
