const STORAGE_KEY = 'co2-temp-monitor:chart-settings';

export const SETTINGS_LIMITS = {
    length: {defaultValue: '300', min: 2, max: 5000},
    ratio: {defaultValue: '1', min: 0, max: 1},
    tailMinutes: {defaultValue: '30', min: 1, max: 240},
    tailPoints: {defaultValue: '60', min: 2, max: 1000},
    tailRefresh: {defaultValue: '15', min: 1, max: 3600},
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

function normalizeSettingNumber(name, value) {
    const limits = SETTINGS_LIMITS[name];
    return normalizeNumberString(value, limits.defaultValue, limits.min, limits.max);
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
        length: normalizeSettingNumber('length', stored.length),
        ratio: normalizeSettingNumber('ratio', stored.ratio),
        tailMinutes: normalizeSettingNumber('tailMinutes', stored.tailMinutes),
        tailPoints: normalizeSettingNumber('tailPoints', stored.tailPoints),
        tailRefresh: normalizeSettingNumber('tailRefresh', stored.tailRefresh),
        limits: normalizeLimits(stored.limits),
    };
}

export function readStoredSensorLimits(key) {
    return readStoredSettings().limits[key] || {min: '', max: ''};
}

export function writeStoredSettings({length, ratio, tailMinutes, tailPoints, tailRefresh, selectedSensors}) {
    const previous = readStoredSettings();
    const next = {
        ...previous,
        length: normalizeSettingNumber('length', length),
        ratio: normalizeSettingNumber('ratio', ratio),
        tailMinutes: normalizeSettingNumber('tailMinutes', tailMinutes),
        tailPoints: normalizeSettingNumber('tailPoints', tailPoints),
        tailRefresh: normalizeSettingNumber('tailRefresh', tailRefresh),
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
