export function initUI({onAddSensor, onRemoveSensor, onReorderSensors, onModalClose}) {
    // --- Get DOM Elements ---
    const elements = {
        periodEl: document.getElementById('period'),
        settingsBtn: document.getElementById('settings-btn'),
        modal: document.getElementById('modal'),
        modalTagCloud: document.getElementById('modal-tag-cloud'),
        selectedSensorsList: document.getElementById('selected-sensors-list'),
        modalClose: document.getElementById('modal-close'),
        lengthEl: document.getElementById('length'),
        ratioEl: document.getElementById('ratio'),
        chartTitleEl: document.getElementById('chart-title'),
        metaLineEl: document.getElementById('meta-line'),
        downloadBtn: document.getElementById('download'),
        ctx: document.getElementById('chart'),
    };

    // --- Modal Logic ---
    function showModal() {
        elements.modal.style.display = 'flex';
        elements.modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
        elements.modal.style.display = 'none';
        elements.modal.setAttribute('aria-hidden', 'true');
        if (typeof onModalClose === 'function') onModalClose();
    }

    elements.settingsBtn.addEventListener('click', showModal);
    elements.modalClose.addEventListener('click', closeModal);
    elements.modal.addEventListener('click', (e) => { if (e.target === elements.modal) closeModal(); });
    window.addEventListener('keydown', (e) => { if (e.key === 's' && document.activeElement.tagName !== 'INPUT') showModal(); });

    // --- Drag and Drop State ---
    let draggedItem = null;

    // --- Render Functions ---
    function renderAvailableSensors(allSensors = [], selectedKeys = []) {
        elements.modalTagCloud.innerHTML = '';
        allSensors
            .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key))
            .forEach(sensor => {
                const isSelected = selectedKeys.includes(sensor.key);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tag';
                btn.dataset.key = sensor.key;
                btn.textContent = sensor.name ? `${sensor.name}${sensor.unit ? ` · ${sensor.unit}` : ''}` : sensor.key;
                btn.disabled = isSelected;

                btn.addEventListener('click', () => {
                    if (!isSelected && typeof onAddSensor === 'function') {
                        onAddSensor(sensor.key);
                    }
                });
                elements.modalTagCloud.appendChild(btn);
            });
    }

    function renderSelectedSensors(selectedSensors = []) {
        elements.selectedSensorsList.innerHTML = '';
        if (selectedSensors.length === 0) {
            elements.selectedSensorsList.innerHTML = `<div class="placeholder-text">Select a sensor from the right to begin.</div>`;
            return;
        }

        selectedSensors.forEach(sensor => {
            const item = document.createElement('div');
            item.className = 'selected-sensor-item';
            item.dataset.key = sensor.key;
            item.draggable = true;

            item.innerHTML = `
                <div class="drag-handle" title="Drag to reorder">
                    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="16" height="16" viewBox="0 0 30 30"><path d="M 3 7 A 1.0001 1.0001 0 1 0 3 9 L 27 9 A 1.0001 1.0001 0 1 0 27 7 L 3 7 z M 3 14 A 1.0001 1.0001 0 1 0 3 16 L 27 16 A 1.0001 1.0001 0 1 0 27 14 L 3 14 z M 3 21 A 1.0001 1.0001 0 1 0 3 23 L 27 23 A 1.0001 1.0001 0 1 0 27 21 L 3 21 z"></path></svg>
                </div>
                <div class="sensor-name">${sensor.name}</div>
                <div class="sensor-controls-wrapper">
                    <div class="sensor-control">
                        <label for="min-${sensor.key}">Min</label>
                        <input type="number" id="min-${sensor.key}" class="sensor-min-input" value="${sensor.min || ''}" placeholder="auto">
                    </div>
                    <div class="sensor-control">
                        <label for="max-${sensor.key}">Max</label>
                        <input type="number" id="max-${sensor.key}" class="sensor-max-input" value="${sensor.max || ''}" placeholder="auto">
                    </div>
                </div>
                <button class="remove-sensor-btn" title="Remove sensor">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>
                </button>
            `;

            // Event listener for removal
            item.querySelector('.remove-sensor-btn').addEventListener('click', () => {
                if (typeof onRemoveSensor === 'function') onRemoveSensor(sensor.key);
            });

            // Drag and drop event listeners
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                setTimeout(() => item.classList.add('dragging'), 0);
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedItem = null;

                // Get the new order of keys
                const newOrder = [...elements.selectedSensorsList.children].map(child => child.dataset.key);
                if (typeof onReorderSensors === 'function') onReorderSensors(newOrder);
            });

            elements.selectedSensorsList.appendChild(item);
        });
    }

    // Drag over logic
    elements.selectedSensorsList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(elements.selectedSensorsList, e.clientY);
        const currentElement = document.querySelector('.dragging');
        if (afterElement == null) {
            elements.selectedSensorsList.appendChild(currentElement);
        } else {
            elements.selectedSensorsList.insertBefore(currentElement, afterElement);
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.selected-sensor-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return {offset: offset, element: child};
            } else {
                return closest;
            }
        }, {offset: Number.NEGATIVE_INFINITY}).element;
    }

    // --- Public Functions ---
    function renderApp(allSensors, selectedSensors) {
        const selectedKeys = selectedSensors.map(s => s.key);
        renderAvailableSensors(allSensors, selectedKeys);
        renderSelectedSensors(selectedSensors);
    }

    function readSelectedSensorValues() {
        const values = [];
        elements.selectedSensorsList.querySelectorAll('.selected-sensor-item').forEach(item => {
            values.push({
                key: item.dataset.key,
                min: item.querySelector('.sensor-min-input').value,
                max: item.querySelector('.sensor-max-input').value,
            });
        });
        return values;
    }

    return {...elements, renderApp, readSelectedSensorValues};
}
