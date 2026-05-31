import {closeModal as closeBaseModal, openModal} from './modal-utils.js';
import {readStoredSensorLimits} from './settings-storage.js';

let modalState = {
    allSensors: [],
    selectedSensors: [],
    resolvePromise: null,
    rejectPromise: null,
};

let touchDragState = null;

const elements = {
    modal: document.getElementById('modal'),
    modalTagCloud: document.getElementById('modal-tag-cloud'),
    selectedSensorsList: document.getElementById('selected-sensors-list'),
    modalClose: document.getElementById('modal-close'),
};

function renderAvailableSensors() {
    const selectedKeys = modalState.selectedSensors.map(s => s.key);
    elements.modalTagCloud.innerHTML = '';

    modalState.allSensors
        .forEach(sensor => elements.modalTagCloud.appendChild(createAvailableSensorButton(sensor, selectedKeys)));
}

function renderSelectedSensors() {
    elements.selectedSensorsList.innerHTML = '';
    if (modalState.selectedSensors.length === 0) {
        elements.selectedSensorsList.innerHTML = `<div class="placeholder-text">Select a sensor from the right to begin.</div>`;
        return;
    }

    modalState.selectedSensors.forEach(sensor => elements.selectedSensorsList.appendChild(createSelectedSensorItem(sensor)));
}

function renderModal() {
    renderAvailableSensors();
    renderSelectedSensors();
}

function createAvailableSensorButton(sensor, selectedKeys) {
    const isSelected = selectedKeys.includes(sensor.key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag';
    btn.dataset.key = sensor.key;
    btn.textContent = sensor.name ? `${sensor.name}${sensor.unit ? ` · ${sensor.unit}` : ''}` : sensor.key;
    btn.disabled = isSelected;
    btn.addEventListener('click', () => handleAddSensor(sensor.key));
    return btn;
}

function createSelectedSensorItem(sensor) {
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
    item.querySelector('.drag-handle').addEventListener('pointerdown', (event) => handleTouchDragStart(event, item));
    item.addEventListener('dragstart', () => { setTimeout(() => item.classList.add('dragging'), 0); });
    item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        handleReorder();
    });

    return item;
}

function handleAddSensor(key) {
    preserveSelectedSensorValues();
    const sensor = modalState.allSensors.find(s => s.key === key);
    if (sensor) {
        modalState.selectedSensors.push({...sensor, ...readStoredSensorLimits(sensor.key)});
        renderModal();
    }
}

function handleRemoveSensor(key) {
    preserveSelectedSensorValues();
    modalState.selectedSensors = modalState.selectedSensors.filter(s => s.key !== key);
    renderModal();
}

function preserveSelectedSensorValues() {
    const currentValues = readSelectedSensorValues();
    modalState.selectedSensors.forEach(s => {
        const item = currentValues.find(v => v.key === s.key);
        if (item) {
            s.min = item.min;
            s.max = item.max;
        }
    });
}

function handleReorder() {
    preserveSelectedSensorValues();
    const newOrderKeys = Array.from(elements.selectedSensorsList.children).map(child => child.dataset.key);
    modalState.selectedSensors.sort((a, b) => newOrderKeys.indexOf(a.key) - newOrderKeys.indexOf(b.key));
    renderModal();
}

function readSelectedSensorValues() {
    return Array.from(elements.selectedSensorsList.querySelectorAll('.selected-sensor-item')).map(item => ({
        key: item.dataset.key,
        min: item.querySelector('.sensor-min-input').value,
        max: item.querySelector('.sensor-max-input').value,
    }));
}

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

function moveDraggingElement(clientY) {
    const afterElement = getDragAfterElement(elements.selectedSensorsList, clientY);
    const currentElement = elements.selectedSensorsList.querySelector('.dragging');
    if (!currentElement) return;

    if (afterElement == null) {
        elements.selectedSensorsList.appendChild(currentElement);
    } else {
        elements.selectedSensorsList.insertBefore(currentElement, afterElement);
    }
}

function handleTouchDragStart(event, item) {
    if (event.pointerType === 'mouse') return;

    event.preventDefault();
    touchDragState = {
        item,
        handle: event.currentTarget,
        pointerId: event.pointerId,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    item.classList.add('dragging');
}

function handleTouchDragMove(event) {
    if (!touchDragState || event.pointerId !== touchDragState.pointerId) return;
    event.preventDefault();
    moveDraggingElement(event.clientY);
}

function handleTouchDragEnd(event) {
    if (!touchDragState || event.pointerId !== touchDragState.pointerId) return;

    touchDragState.handle.releasePointerCapture?.(event.pointerId);
    touchDragState.item.classList.remove('dragging');
    touchDragState = null;
    handleReorder();
}

elements.selectedSensorsList.addEventListener('dragover', (event) => {
    event.preventDefault();
    moveDraggingElement(event.clientY);
});

elements.selectedSensorsList.addEventListener('pointermove', handleTouchDragMove);
elements.selectedSensorsList.addEventListener('pointerup', handleTouchDragEnd);
elements.selectedSensorsList.addEventListener('pointercancel', handleTouchDragEnd);

function closeModal() {
    closeBaseModal(elements.modal);
    modalState.resolvePromise = null;
    modalState.rejectPromise = null;
}

function handleConfirm() {
    if (modalState.resolvePromise) {
        preserveSelectedSensorValues();
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

export function initSettingsModal() {
    elements.modalClose.addEventListener('click', handleConfirm);
    elements.modal.addEventListener('click', (event) => {
        if (event.target === elements.modal) handleCancel();
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && elements.modal.getAttribute('aria-hidden') === 'false') {
            handleCancel();
        }
    });
}

export function showConfigModal(allSensors, currentSelectedSensors) {
    return new Promise((resolve, reject) => {
        modalState.allSensors = allSensors;
        modalState.selectedSensors = JSON.parse(JSON.stringify(currentSelectedSensors));
        modalState.resolvePromise = resolve;
        modalState.rejectPromise = reject;

        renderModal();

        openModal(elements.modal);
    });
}
