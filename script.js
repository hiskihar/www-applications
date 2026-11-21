const sandbox = document.getElementById('sandbox');
const realContent = document.getElementById('sandbox-content');
const lensWindow = document.getElementById('lens-window');
const mapNodes = document.querySelectorAll('feImage');
const themeToggle = document.getElementById('theme-toggle');
const pinToggle = document.getElementById('pin-toggle');
let keepLensOn = false;

function snapLensTo(x, y) {
    currentX = x;
    currentY = y;
    targetX = x;
    targetY = y;

    lensWindow.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1, 1)`;
    mapNodes.forEach(node => {
        node.setAttribute('x', x);
        node.setAttribute('y', y);
        node.setAttribute('width', LENS_WIDTH);
        node.setAttribute('height', LENS_HEIGHT);
    });
    lensWindow.classList.remove('hidden');
}

pinToggle.addEventListener('click', () => {
    keepLensOn = !keepLensOn;
    pinToggle.setAttribute('aria-pressed', String(keepLensOn));

    if (keepLensOn) {
        clearTimeout(hideTimeout);

        // If the lens hasn't been positioned yet, place it in the center of the sandbox
        const x = currentX ?? (sandbox.clientWidth - LENS_WIDTH) / 2;
        const y = currentY ?? (sandbox.clientHeight - LENS_HEIGHT) / 2;
        snapLensTo(x, y);
    } else if (!isSelectionInSandbox(window.getSelection())) {
        hideLens();
    }
});


themeToggle.addEventListener('click', () => {
    const isLight = document.documentElement.dataset.theme === 'light';
    document.documentElement.dataset.theme = isLight ? 'dark' : 'light';
    themeToggle.setAttribute('aria-pressed', String(!isLight));
    themeToggle.textContent = isLight ? 'Light mode' : 'Dark mode';
});

const sandboxContent = document.getElementById('sandbox-content');
const filterRadios = document.querySelectorAll('input[name="filter-variant"]');

let activeFilterId = document.querySelector('input[name="filter-variant"]:checked').value;
let activeFeImages = [];

function setActiveFilter(filterId) {
    activeFilterId = filterId;
    activeFeImages = Array.from(document.querySelectorAll(`#${filterId} feImage`));
    sandboxContent.style.filter = `url(#${filterId})`;
}

filterRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
        setActiveFilter(e.target.value);
    });
});

setActiveFilter(activeFilterId);

const LENS_WIDTH = 107;
const LENS_HEIGHT = 79;
const FLOAT_OFFSET = 20;

let rafId = null;
let isSelecting = false;
let hideTimeout = null;
let hasSelectedInCurrentDrag = false;

// --- Animation State ---
let currentX = null;
let currentY = null;
let targetX = 0;
let targetY = 0;
let isAnimating = false;

// The unified easing loop that moves both HTML and SVG together
function animateLens() {
    // THE FIX: If hideLens() killed the animation, abort immediately 
    // before we overwrite the -9999 coordinates.
    if (!isAnimating) return; 

    // 1. Calculate the distance left to travel
    const dx = targetX - currentX;
    const dy = targetY - currentY;

    // 2. Move 20% of the remaining distance per frame
    const vx = dx * 0.1;
    const vy = dy * 0.1;
    
    currentX += vx;
    currentY += vy;

    // --- LIQUID PHYSICS (Squash & Stretch) ---
    const flex = 0.03; 
    let scaleX = 1.0 + (Math.abs(vx) * flex) - (Math.abs(vy) * flex);
    let scaleY = 1.0 + (Math.abs(vy) * flex) - (Math.abs(vx) * flex);

    scaleX = Math.max(0.8, Math.min(1.2, scaleX));
    scaleY = Math.max(0.8, Math.min(1.2, scaleY));

    // 3. Apply to HTML visual ring with the scale transform appended
    lensWindow.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) scale(${scaleX}, ${scaleY})`;

    // 4. Apply to ALL SVG maps
    const scaledWidth = LENS_WIDTH * scaleX;
    const scaledHeight = LENS_HEIGHT * scaleY;
    
    const mapX = currentX + (LENS_WIDTH - scaledWidth) / 2;
    const mapY = currentY + (LENS_HEIGHT - scaledHeight) / 2;

    mapNodes.forEach(node => {
        node.setAttribute('x', mapX);
        node.setAttribute('y', mapY);
        node.setAttribute('width', scaledWidth);
        node.setAttribute('height', scaledHeight);
    });

    // 5. Continue looping until we are virtually at the target
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        requestAnimationFrame(animateLens);
    } else {
        // Snap to perfect 1.0 scale when resting
        lensWindow.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) scale(1, 1)`;
        mapNodes.forEach(node => {
            node.setAttribute('x', targetX);
            node.setAttribute('y', targetY);
            node.setAttribute('width', LENS_WIDTH);
            node.setAttribute('height', LENS_HEIGHT);
        });
        isAnimating = false;
    }
}

// Check if the selection is inside our real content box
function isSelectionInSandbox(selection) {
    if (!selection || selection.rangeCount === 0) return false;
    if (!realContent.contains(selection.focusNode)) return false;

    if (selection.isCollapsed) {
        // Keep alive ONLY if we are actively dragging AND we have already 
        // successfully highlighted text during this specific drag gesture.
        return isSelecting && hasSelectedInCurrentDrag;
    }

    // We have a valid, non-collapsed selection
    hasSelectedInCurrentDrag = true;
    return true;
}

function hideLens() {
    if (keepLensOn) return;

    lensWindow.classList.add('hidden');
    isAnimating = false; // Kill the animation loop

    mapNodes.forEach(node => {
        node.setAttribute('x', -9999);
        node.setAttribute('y', -9999);
    });
}

function renderTextMagnifier() {
    rafId = null;
    const selection = window.getSelection();

    if (!isSelectionInSandbox(selection)) {
        hideLens();
        return;
    }

    const activeRange = document.createRange();
    activeRange.setStart(selection.focusNode, selection.focusOffset);
    activeRange.collapse(true);

    const activeRect = activeRange.getBoundingClientRect();
    const sandboxRect = sandbox.getBoundingClientRect();

    if (activeRect.width === 0 && activeRect.height === 0 && activeRect.x === 0) {
        hideLens();
        return;
    }

    const caretX = activeRect.left - sandboxRect.left + (activeRect.width / 2);
    const caretY = activeRect.top - sandboxRect.top + (activeRect.height / 2);

    // Update target coordinates
    targetX = caretX - (LENS_WIDTH / 2);
    targetY = caretY - FLOAT_OFFSET - LENS_HEIGHT;

    if (currentX === null || currentY === null) {
        currentX = targetX;
        currentY = targetY;
        
        // Also snap the SVG maps instantly so they don't flash at (0,0)
        mapNodes.forEach(node => {
            node.setAttribute('x', currentX);
            node.setAttribute('y', currentY);
        });
    }

    // Remove the hidden class so it fades back in (if it was fading out)
    lensWindow.classList.remove('hidden');

    // Trigger the animation loop if it's not already running
    if (!isAnimating) {
        isAnimating = true;
        animateLens();
    }
}

function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(renderTextMagnifier);
}

// --- Tracking Events ---

realContent.addEventListener('pointerdown', () => {
    isSelecting = true;
    hasSelectedInCurrentDrag = false;
    clearTimeout(hideTimeout);
});

document.addEventListener('pointermove', () => {
    if (isSelecting) scheduleUpdate();
});

document.addEventListener('pointerup', () => {
    if (!isSelecting) return;
    isSelecting = false;
    scheduleUpdate();
    
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideLens, 1500);
});

document.addEventListener('selectionchange', () => {
    scheduleUpdate();
    
    if (!isSelecting) {
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hideLens, 1500);
    }
});
