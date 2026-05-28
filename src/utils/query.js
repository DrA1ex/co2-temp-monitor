export function getFirstValue(value) {
    if (Array.isArray(value)) {
        return getFirstValue(value[0]);
    }

    if (typeof value === "string") {
        return value;
    }

    return null;
}

export function parseBoundedFloat(value, fallback, min, max) {
    const parsed = Number.parseFloat(getFirstValue(value) ?? "");
    if (!Number.isFinite(parsed)) return fallback;

    return Math.max(min, Math.min(max, parsed));
}

export function parseBoundedInt(value, fallback, min, max) {
    const parsed = Number.parseInt(getFirstValue(value) ?? "", 10);
    if (!Number.isFinite(parsed)) return fallback;

    return Math.max(min, Math.min(max, parsed));
}

export function parseStringList(value) {
    const raw = Array.isArray(value)
        ? value.map(getFirstValue).filter(Boolean).join(",")
        : getFirstValue(value);

    if (!raw) return null;

    const values = raw
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);

    return values.length > 0 ? values : null;
}
