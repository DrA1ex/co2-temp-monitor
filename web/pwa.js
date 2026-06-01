const STATE_STORAGE_KEY = 'co2-temp-monitor:pwa-state';

function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function readStoredState() {
    try {
        const raw = localStorage.getItem(STATE_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.warn('Failed to read PWA state:', error);
        return null;
    }
}

function writeStoredState(state) {
    try {
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.warn('Failed to write PWA state:', error);
    }
}

export function createPwaManager({getState, applyState}) {
    function restoreState() {
        if (!isStandalone()) return false;

        const state = readStoredState();
        if (!state) return false;

        applyState(state);
        return true;
    }

    function sync() {
        if (!isStandalone()) return;
        writeStoredState(getState());
    }

    return {
        isStandalone,
        restoreState,
        sync,
    };
}
