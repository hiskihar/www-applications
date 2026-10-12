const lens = document.getElementById('lens-window');

let rafId = null;
let isSelecting = false;
let hideTimeout = null;

// Shift the lens up by exactly the size of the masked half
const FLOAT_OFFSET = 55; 

function renderMagnifier() {
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

    if (activeRect.width === 0 && activeRect.height === 0 && activeRect.x === 0) {
        lens.classList.add('hidden');
        return;
    }

    // 1. Account for scroll offset so the lens tracks relative to the document
    const caretX = activeRect.left + window.scrollX;
    const caretY = activeRect.top + window.scrollY;

    // 2. Position the lens window above the active line
    const lensX = caretX;
    const lensY = caretY - FLOAT_OFFSET;

    // Use translateX(-50%) to center horizontally; Y is fully handled by FLOAT_OFFSET
    lens.style.transform = `translate3d(${lensX}px, ${lensY}px, 0) translateX(-50%)`;

    lens.classList.remove('hidden');
}

function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(renderMagnifier);
}

document.addEventListener('pointerdown', () => {
    isSelecting = true;
    clearTimeout(hideTimeout);
});

// Update continuously while dragging selection
document.addEventListener('pointermove', () => {
    if (isSelecting) {
        scheduleUpdate();
    }
});

document.addEventListener('pointerup', () => {
    isSelecting = false;
    scheduleUpdate();

    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        lens.classList.add('hidden');
    }, 1500);
});

document.addEventListener('selectionchange', () => {
    scheduleUpdate();
});