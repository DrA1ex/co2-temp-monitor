const FULLSCREEN_OPEN_LABEL = 'Open chart fullscreen';
const FULLSCREEN_CLOSE_LABEL = 'Close fullscreen chart';

export function bindChartFullscreen({cardEl, fullscreenBtn, onResize}) {
    function updateButtonState(isFullscreen) {
        if (!fullscreenBtn) return;
        const label = isFullscreen ? FULLSCREEN_CLOSE_LABEL : FULLSCREEN_OPEN_LABEL;
        fullscreenBtn.setAttribute('aria-label', label);
        fullscreenBtn.title = label;
    }

    function enterPseudoFullscreen() {
        if (!cardEl) return;
        cardEl.classList.add('is-pseudo-fullscreen');
        document.body.classList.add('chart-pseudo-fullscreen-active');
        updateButtonState(true);
        onResize?.();
    }

    function exitPseudoFullscreen() {
        if (!cardEl?.classList.contains('is-pseudo-fullscreen')) return;
        cardEl.classList.remove('is-pseudo-fullscreen');
        document.body.classList.remove('chart-pseudo-fullscreen-active');
        updateButtonState(Boolean(document.fullscreenElement));
        onResize?.();
    }

    async function toggleFullscreen() {
        if (!cardEl) return;

        if (cardEl.classList.contains('is-pseudo-fullscreen')) {
            exitPseudoFullscreen();
            return;
        }

        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else if (cardEl.requestFullscreen) {
                await cardEl.requestFullscreen();
            } else {
                enterPseudoFullscreen();
            }
        } catch (error) {
            console.error('Fullscreen toggle failed', error);
            enterPseudoFullscreen();
        }
    }

    fullscreenBtn?.addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', () => {
        const isFullscreen = Boolean(document.fullscreenElement);
        if (isFullscreen) {
            exitPseudoFullscreen();
        }
        updateButtonState(isFullscreen);
        onResize?.();
    });

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            exitPseudoFullscreen();
        }
    });

    return {
        exitPseudoFullscreen,
    };
}
