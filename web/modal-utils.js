let openModalCount = 0;

export function openModal(modalEl) {
    if (!modalEl || modalEl.getAttribute('aria-hidden') === 'false') return;
    openModalCount += 1;
    document.body.classList.add('modal-open');
    modalEl.setAttribute('aria-hidden', 'false');
}

export function closeModal(modalEl) {
    if (!modalEl || modalEl.getAttribute('aria-hidden') !== 'false') return;
    modalEl.setAttribute('aria-hidden', 'true');
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) {
        document.body.classList.remove('modal-open');
    }
}
