const IMPORTED_START_URL_STORAGE_KEY = 'co2-temp-monitor:pwa-imported-start-url';
const STATE_STORAGE_KEY = 'co2-temp-monitor:pwa-state';
const MANIFEST_UPDATE_DELAY_MS = 500;

let manifestUpdateTimer = null;

function toAbsoluteUrl(value) {
    return new URL(value, window.location.href).href;
}

function updateAssetUrls(value) {
    if (Array.isArray(value)) {
        value.forEach(updateAssetUrls);
        return;
    }

    if (!value || typeof value !== 'object') return;

    Object.entries(value).forEach(([key, childValue]) => {
        if (key === 'src' && typeof childValue === 'string') {
            value[key] = toAbsoluteUrl(childValue);
            return;
        }

        updateAssetUrls(childValue);
    });
}

function getManifestLink() {
    let link = document.querySelector('link[rel="manifest"]');
    if (link) return link;

    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
    return link;
}

function encodeBase64Url(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

function decodeBase64Url(value) {
    const base64 = value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

function getStateParam() {
    return new URLSearchParams(location.search).get('state');
}

function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function getPwaStartUrl(state) {
    const url = new URL(location.pathname || './', location.origin);
    url.searchParams.set('state', encodeBase64Url(state));
    return url.href;
}

function readStoredJson(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.warn(`Failed to read ${key}:`, error);
        return null;
    }
}

function writeStoredJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Failed to write ${key}:`, error);
    }
}

function readStoredState() {
    const parsed = readStoredJson(STATE_STORAGE_KEY);
    if (!parsed) return null;
    return parsed;
}

function hasImportedStartUrl(url) {
    try {
        return localStorage.getItem(IMPORTED_START_URL_STORAGE_KEY) === url;
    } catch (error) {
        console.warn('Failed to read PWA launch state:', error);
        return false;
    }
}

function markStartUrlImported(url) {
    try {
        localStorage.setItem(IMPORTED_START_URL_STORAGE_KEY, url);
    } catch (error) {
        console.warn('Failed to save PWA launch state:', error);
    }
}

export function createPwaManager({
    manifestUrl,
    getState,
    applyState,
    importSettings,
    replaceUrl,
}) {
    function buildLaunchState() {
        return {
            version: 1,
            ...getState(),
        };
    }

    async function updateManifest() {
        try {
            const response = await fetch(manifestUrl, {cache: 'no-cache'});
            if (!response.ok) throw new Error(response.statusText || 'Unable to load manifest');

            const manifest = await response.json();
            updateAssetUrls(manifest);

            manifest.start_url = getPwaStartUrl(buildLaunchState());
            manifest.scope = new URL(manifest.scope || './', window.location.href).href;

            getManifestLink().href = `data:application/manifest+json;charset=utf-8,${
                encodeURIComponent(JSON.stringify(manifest, null, 2))
            }`;
        } catch (error) {
            console.error('Unable to load manifest', error);
        }
    }

    function scheduleManifestUpdate() {
        clearTimeout(manifestUpdateTimer);
        manifestUpdateTimer = setTimeout(() => {
            manifestUpdateTimer = null;
            updateManifest();
        }, MANIFEST_UPDATE_DELAY_MS);
    }

    function persistState() {
        if (!isStandalone()) return;
        writeStoredJson(STATE_STORAGE_KEY, getState());
    }

    function sync() {
        persistState();
        scheduleManifestUpdate();
    }

    function normalizeLaunchState() {
        const encodedState = getStateParam();
        if (!encodedState) return false;

        if (!isStandalone()) {
            try {
                applyState(decodeBase64Url(encodedState));
            } catch (error) {
                console.warn('Failed to decode URL state:', error);
                return false;
            }

            replaceUrl();
            return true;
        }

        const alreadyImported = hasImportedStartUrl(encodedState);
        if (alreadyImported) {
            const state = readStoredState();
            if (state) applyState(state);
        } else {
            let launchState;
            try {
                launchState = decodeBase64Url(encodedState);
            } catch (error) {
                console.warn('Failed to decode PWA launch state:', error);
                replaceUrl();
                return false;
            }

            applyState(launchState);
            importSettings();
            persistState();
            markStartUrlImported(encodedState);
        }

        replaceUrl();
        return true;
    }

    return {
        isStandalone,
        normalizeLaunchState,
        persistState,
        sync,
        updateManifest,
    };
}
