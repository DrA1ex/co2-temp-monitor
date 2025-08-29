export function initUI({ onSensorToggle, onModalClose }) {
    const periodEl = document.getElementById('period');
    const settingsBtn = document.getElementById('settings-btn');
    const modal = document.getElementById('modal');
    const modalTagCloud = document.getElementById('modal-tag-cloud');
    const modalClose = document.getElementById('modal-close');
    const lengthEl = document.getElementById('length');
    const ratioEl = document.getElementById('ratio');
    const minEl = document.getElementById('min');
    const maxEl = document.getElementById('max');
    const chartTitleEl = document.getElementById('chart-title');
    const metaLineEl = document.getElementById('meta-line');
    const downloadBtn = document.getElementById('download');
    const ctx = document.getElementById('chart');

    function showModal() {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    }
    function closeModal() {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        if (typeof onModalClose === 'function') onModalClose();
    }

    settingsBtn.addEventListener('click', showModal);
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // keyboard shortcut
    window.addEventListener('keydown', (event) => {
        if (event.key === 's' && document.activeElement.tagName !== 'INPUT') showModal();
    });

    function populateModalTags(sensors = [], selectedSet = new Set()) {
        modalTagCloud.innerHTML = '';
        sensors
            .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key))
            .forEach(sensor => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `tag${selectedSet.has(sensor.key) ? ' selected' : ''}`;
                btn.dataset.key = sensor.key;
                btn.textContent = sensor.name ? `${sensor.name}${sensor.unit ? ` · ${sensor.unit}` : ''}` : sensor.key;

                btn.addEventListener('click', () => {
                    const now = selectedSet.has(sensor.key);
                    if (now) btn.classList.remove('selected'); else btn.classList.add('selected');
                    if (typeof onSensorToggle === 'function') onSensorToggle(sensor.key, !now);
                });

                modalTagCloud.appendChild(btn);
            });
    }

    return {
        periodEl, settingsBtn, modal, modalTagCloud, modalClose,
        lengthEl, ratioEl, minEl, maxEl, chartTitleEl, metaLineEl,
        downloadBtn, ctx, showModal, closeModal, populateModalTags,
    };
}
