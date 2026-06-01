import {closeModal, openModal} from './modal-utils.js';

export class UnauthorizedError extends Error {
    constructor(message = 'Authorization required') {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

function getErrorMessage(response, fallback) {
    return response.json()
        .then(json => json?.error || fallback)
        .catch(() => fallback);
}

export function createAuthClient(ui, hooks = {}) {
    let pendingAuth = null;

    function setError(message = '') {
        if (!ui.authErrorEl) return;
        ui.authErrorEl.textContent = message;
        ui.authErrorEl.hidden = !message;
    }

    function setBusy(isBusy) {
        if (ui.authSubmitEl) ui.authSubmitEl.disabled = isBusy;
        if (ui.authLoginEl) ui.authLoginEl.disabled = isBusy;
        if (ui.authPasswordEl) ui.authPasswordEl.disabled = isBusy;
    }

    function showAuthModal() {
        setError('');
        openModal(ui.authModalEl);
        requestAnimationFrame(() => ui.authLoginEl?.focus());
    }

    function hideAuthModal() {
        closeModal(ui.authModalEl);
        ui.authPasswordEl.value = '';
        setError('');
    }

    async function check() {
        const response = await fetch('/auth', {
            method: 'GET',
            credentials: 'same-origin',
            headers: {'Accept': 'application/json'},
        });

        if (response.status === 401) return false;
        if (!response.ok) throw new Error(await getErrorMessage(response, 'Failed to check authorization'));
        return true;
    }

    async function login(loginValue, password) {
        const response = await fetch('/auth', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({login: loginValue, password}),
        });

        if (!response.ok) {
            throw new UnauthorizedError(await getErrorMessage(response, 'Invalid login or password'));
        }
    }

    function requireAuth() {
        if (pendingAuth) return pendingAuth;

        hooks.onAuthRequired?.();
        showAuthModal();
        pendingAuth = new Promise((resolve) => {
            const onSubmit = async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');

                try {
                    await login(ui.authLoginEl.value.trim(), ui.authPasswordEl.value);
                    ui.authFormEl.removeEventListener('submit', onSubmit);
                    hideAuthModal();
                    hooks.onAuthResolved?.();
                    resolve();
                } catch (error) {
                    setError(error.message || 'Invalid login or password');
                    ui.authPasswordEl?.focus();
                } finally {
                    setBusy(false);
                }
            };

            ui.authFormEl.addEventListener('submit', onSubmit);
        }).finally(() => {
            pendingAuth = null;
        });

        return pendingAuth;
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                ...(options.headers || {}),
            },
        });

        if (response.status === 401) {
            await requireAuth();
            return fetchJson(url, options);
        }

        if (!response.ok) {
            throw new Error(await getErrorMessage(response, response.statusText || 'Request failed'));
        }

        return response.json();
    }

    return {
        check,
        requireAuth,
        fetchJson,
    };
}
