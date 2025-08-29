// This object will hold a local copy of the state while the modal is open
let modalState = {
    allSensors: [],
    selectedSensors: [],
    resolvePromise: null, // To resolve the promise when done
    rejectPromise: null,  // To reject on cancellation
};

// --- DOM Element Cache ---
// We find elements once and store them here
const elements = {
    modal: document.getElementById('modal'),
    modalTagCloud: document.getElementById('modal-tag-cloud'),
    selectedSensorsList: document.getElementById('selected-sensors-list'),
    modalClose: document.getElementById('modal-close'),
    // We add settingsBtn here to attach its listener internally
    settingsBtn: document.getElementById('settings-btn'),
};

// --- Private Render Functions ---

function renderAvailableSensors() {
    const selectedKeys = modalState.selectedSensors.map(s => s.key);
    elements.modalTagCloud.innerHTML = '';

    modalState.allSensors
        .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key))
        .forEach(sensor => {
            const isSelected = selectedKeys.includes(sensor.key);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tag';
            btn.dataset.key = sensor.key;
            btn.textContent = sensor.name ? `${sensor.name}${sensor.unit ? ` · ${sensor.unit}` : ''}` : sensor.key;
            btn.disabled = isSelected;

            btn.addEventListener('click', () => handleAddSensor(sensor.key));
            elements.modalTagCloud.appendChild(btn);
        });
}

function renderSelectedSensors() {
    elements.selectedSensorsList.innerHTML = '';
    if (modalState.selectedSensors.length === 0) {
        elements.selectedSensorsList.innerHTML = `<div class="placeholder-text">Select a sensor from the right to begin.</div>`;
        return;
    }

    modalState.selectedSensors.forEach(sensor => {
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

        item.querySelector('.remove-sensor-btn').addEventListener('click', () => handleRemoveSensor(sensor.key));

        // Drag and drop event listeners
        item.addEventListener('dragstart', () => { setTimeout(() => item.classList.add('dragging'), 0); });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            handleReorder();
        });

        elements.selectedSensorsList.appendChild(item);
    });
}

/** Rerenders the entire modal based on the current modalState */
function renderModal() {
    renderAvailableSensors();
    renderSelectedSensors();
}

// --- Private UI Interaction Handlers ---

function handleAddSensor(key) {
    const sensor = modalState.allSensors.find(s => s.key === key);
    if (sensor) {
        modalState.selectedSensors.push({ ...sensor, min: '', max: '' });
        renderModal();
    }
}

function handleRemoveSensor(key) {
    modalState.selectedSensors = modalState.selectedSensors.filter(s => s.key !== key);
    renderModal();
}

function handleReorder() {
    const currentValues = readSelectedSensorValues();
    const newOrderKeys = Array.from(elements.selectedSensorsList.children).map(child => child.dataset.key);

    // Update local state with current input values before reordering
    modalState.selectedSensors.forEach(s => {
        const item = currentValues.find(v => v.key === s.key);
        if (item) {
            s.min = item.min;
            s.max = item.max;
        }
    });

    // Reorder the array
    modalState.selectedSensors.sort((a, b) => newOrderKeys.indexOf(a.key) - newOrderKeys.indexOf(b.key));
    renderModal();
}

/** Reads the current min/max values from the DOM inputs */
function readSelectedSensorValues() {
    return Array.from(elements.selectedSensorsList.querySelectorAll('.selected-sensor-item')).map(item => ({
        key: item.dataset.key,
        min: item.querySelector('.sensor-min-input').value,
        max: item.querySelector('.sensor-max-input').value,
    }));
}

// --- Drag and Drop Helpers ---

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.selected-sensor-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

elements.selectedSensorsList.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(elements.selectedSensorsList, e.clientY);
    const currentElement = document.querySelector('.dragging');
    if (currentElement) {
        if (afterElement == null) {
            elements.selectedSensorsList.appendChild(currentElement);
        } else {
            elements.selectedSensorsList.insertBefore(currentElement, afterElement);
        }
    }
});

// --- Modal Lifecycle Functions ---

function closeModal() {
    elements.modal.setAttribute('aria-hidden', 'true');
    // Clean up promise handlers to prevent memory leaks
    modalState.resolvePromise = null;
    modalState.rejectPromise = null;
}

function handleConfirm() {
    if (modalState.resolvePromise) {
        const finalValues = readSelectedSensorValues();
        // Update the final state with the latest min/max values before resolving
        modalState.selectedSensors.forEach(s => {
            const final = finalValues.find(f => f.key === s.key);
            if (final) {
                s.min = final.min;
                s.max = final.max;
            }
        });
        modalState.resolvePromise(modalState.selectedSensors);
    }
    closeModal();
}

function handleCancel() {
    if (modalState.rejectPromise) {
        modalState.rejectPromise('Modal closed without saving');
    }
    closeModal();
}

// --- Public API ---

/**
 * Initializes the UI module and returns element references.
 */
export function initUI() {
    // Attach event listeners that are always active
    elements.modalClose.addEventListener('click', handleConfirm);
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) handleCancel();
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.modal.style.display === 'flex') {
            handleCancel();
        }
    });

    // Return a subset of elements for the main app to use
    return {
        periodEl: document.getElementById('period'),
        lengthEl: document.getElementById('length'),
        ratioEl: document.getElementById('ratio'),
        chartTitleEl: document.getElementById('chart-title'),
        metaLineEl: document.getElementById('meta-line'),
        downloadBtn: document.getElementById('download'),
        ctx: document.getElementById('chart'),
        settingsBtn: elements.settingsBtn,
    };
}

/**
 * Shows the configuration modal and returns a Promise with the new selection.
 * @param {Array} allSensors - The list of all available sensors.
 * @param {Array} currentSelectedSensors - The currently selected and ordered sensors.
 * @returns {Promise<Array>} A promise that resolves with the new sensor configuration.
 */
export function showConfigModal(allSensors, currentSelectedSensors) {
    return new Promise((resolve, reject) => {
        // Store the state and promise handlers
        modalState.allSensors = allSensors;
        // Create a deep copy to prevent modifying the original array until "Apply" is clicked
        modalState.selectedSensors = JSON.parse(JSON.stringify(currentSelectedSensors));
        modalState.resolvePromise = resolve;
        modalState.rejectPromise = reject;

        // Initial render of the modal
        renderModal();

        // Show the modal
        elements.modal.setAttribute('aria-hidden', 'false');
    });
}