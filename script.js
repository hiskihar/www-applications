const lens = document.getElementById('lens-window');
const filterLayer = document.querySelector('.lens-filter-layer');
const sandbox = document.querySelector('.sandbox');

// Control buttons & inputs
const variantButtons = document.querySelectorAll('#variant-group .panel-btn');
const filterButtons = document.querySelectorAll('#filter-group .panel-btn');
const scaleSlider = document.getElementById('scale-slider');
const scaleValueDisplay = document.getElementById('scale-value');
const dimmingToggle = document.getElementById('dimming-toggle');
const reduceMotionToggle = document.getElementById('reduce-motion-toggle');
const themeToggle = document.getElementById('theme-toggle');

// Ribbon buttons
const ribbonButtons = document.querySelectorAll('.ribbon-btn');

// Sandboxes
const textSandbox = document.getElementById('text-sandbox');
const imageSandbox = document.getElementById('image-sandbox');

let rafId = null;
let isSelecting = false;
let isImageInteracting = false;
let hideTimeout = null;
let currentMode = 'text';
let activeVariant = 'regular';
let activeFilter = 'liquid-lens';

// Shift the lens up by exactly the size of the masked half
const FLOAT_OFFSET = 55;

// --- Theme Toggle ---
themeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    themeToggle.textContent = isLight ? '☾' : '☼';
});

// --- Ribbon Mode ---
ribbonButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        ribbonButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        currentMode = e.target.getAttribute('data-mode');
        lens.classList.add('hidden');

        if (currentMode === 'image') {
            textSandbox.style.display = 'none';
            imageSandbox.style.display = 'flex';
            lens.classList.add('shape-circle');
        } else {
            textSandbox.style.display = 'flex';
            imageSandbox.style.display = 'none';
            lens.classList.remove('shape-circle');
        }
        updateActiveFilter();
    });
});

// --- Filter & Shape Synchronization ---
function updateActiveFilter() {
    const isCircle = currentMode === 'image';
    const filterId = isCircle ? (activeFilter === 'liquid-lens' ? 'liquid-lens-circle' : activeFilter + '-circle') : activeFilter;
    filterLayer.style.backdropFilter = `url(#${filterId})`;
    filterLayer.style.webkitBackdropFilter = `url(#${filterId})`;
}

// --- Control Panel Button Listeners ---
variantButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        variantButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeVariant = e.target.getAttribute('data-variant');
        lens.classList.toggle('variant-clear', activeVariant === 'clear');
    });
});

filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        filterButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeFilter = e.target.getAttribute('data-filter');
        updateActiveFilter();
    });
});

dimmingToggle.addEventListener('change', (e) => {
    lens.classList.toggle('dimmed', e.target.checked);
});

scaleSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    scaleValueDisplay.textContent = val;
    const displacementMaps = document.querySelectorAll('svg feDisplacementMap');
    displacementMaps.forEach((dm, index) => {
        const baseVal = parseInt(val, 10);
        const offset = index > 0 ? (index * 2) : 0;
        dm.setAttribute('scale', baseVal + offset);
    });
});

reduceMotionToggle.addEventListener('change', (e) => {
    lens.classList.toggle('reduce-motion', e.target.checked);
});

// --- Text Magnifier Tracking Logic ---
function renderTextMagnifier() {
    rafId = null;
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        lens.classList.add('hidden');
        return;
    }

    // Isolate the active caret position
    const activeRange = document.createRange();
    activeRange.setStart(selection.focusNode, selection.focusOffset);
    activeRange.collapse(true);

    const activeRect = activeRange.getBoundingClientRect();
    const sandboxRect = sandbox.getBoundingClientRect();

    if (activeRect.width === 0 && activeRect.height === 0 && activeRect.x === 0) {
        lens.classList.add('hidden');
        return;
    }

    // 1. Account for scroll offset so the lens tracks relative to the document
    const caretX = activeRect.left - sandboxRect.left;
    const caretY = activeRect.top - sandboxRect.top;

    // 2. Position the lens window above the active line
    const lensX = caretX;
    const lensY = caretY - FLOAT_OFFSET;
    
    // Use translateX(-50%) to center horizontally; Y is fully handled by FLOAT_OFFSET
    lens.style.transform = `translate3d(${lensX}px, ${lensY}px, 0) translateX(-50%)`;
    
    lens.classList.remove('hidden');
}

// --- Image Magnifier Tracking Logic ---
function positionImageLens(clientX, clientY) {
    const sandboxRect = sandbox.getBoundingClientRect();
    const lensX = clientX - sandboxRect.left;
    const lensY = clientY - sandboxRect.top - FLOAT_OFFSET;

    lens.style.transform = `translate3d(${lensX}px, ${lensY}px, 0) translateX(-50%)`;
    lens.classList.remove('hidden');
}

imageSandbox.addEventListener('pointerdown', (e) => {
    if (currentMode !== 'image') return;
    isImageInteracting = true;
    clearTimeout(hideTimeout);
    positionImageLens(e.clientX, e.clientY);
});

imageSandbox.addEventListener('pointermove', (e) => {
    if (!isImageInteracting || currentMode !== 'image') return;
    positionImageLens(e.clientX, e.clientY);
});

imageSandbox.addEventListener('pointerup', () => {
    if (currentMode !== 'image') return;
    isImageInteracting = false;
    hideTimeout = setTimeout(() => {
        lens.classList.add('hidden');
    }, 1500);
});

function scheduleUpdate() {
    if (currentMode === 'image') return;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(renderTextMagnifier);
}

document.addEventListener('pointerdown', () => {
    if (currentMode === 'image') return;
    isSelecting = true;
    clearTimeout(hideTimeout);
});

// Update continuously while dragging selection
document.addEventListener('pointermove', () => {
    if (currentMode === 'image') return;
    if (isSelecting) {
        scheduleUpdate();
    }
});

document.addEventListener('pointerup', () => {
    if (currentMode === 'image') return;
    isSelecting = false;
    scheduleUpdate();
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        lens.classList.add('hidden');
    }, 1500);
});

document.addEventListener('selectionchange', () => {
    if (currentMode === 'image') return;
    scheduleUpdate();
});