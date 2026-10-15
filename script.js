class LensSandbox {
    constructor() {
        // Configuration
        this.config = {
            floatOffset: 55,
            hideDelay: 1500,
        };

        // State
        this.state = {
            mode: 'text',
            variant: 'regular',
            filter: 'liquid-lens',
            magnification: 40,
            refraction: 40,
            dispersion: 0.1,
            isSelecting: false,
            isImageInteracting: false,
            rafId: null,
            hideTimeout: null,
            // Retain last known positions for previewing control changes
            lastTextCoords: null,
            lastImageCoords: null
        };

        // DOM Elements
        this.dom = {
            lens: document.getElementById('lens-window'),
            filterLayer: document.querySelector('.lens-filter-layer'),
            sandbox: document.querySelector('.sandbox'),
            textSandbox: document.getElementById('text-sandbox'),
            imageSandbox: document.getElementById('image-sandbox'),
            sandboxImg: document.getElementById('sandbox-img'),
            magnificationSlider: document.getElementById('magnification-slider'),
            refractionSlider: document.getElementById('refraction-slider'),
            dispersionSlider: document.getElementById('dispersion-slider'),
            magnificationValue: document.getElementById('magnification-value'),
            refractionValue: document.getElementById('refraction-value'),
            dispersionValue: document.getElementById('dispersion-value'),
            dimmingToggle: document.getElementById('dimming-toggle'),
            reduceMotionToggle: document.getElementById('reduce-motion-toggle')
        };

        this.init();
    }

    init() {
        // Sync state from DOM in case browser restored cached inputs on reload
        this.state.refraction = parseFloat(this.dom.refractionSlider.value);
        this.state.dispersion = parseFloat(this.dom.dispersionSlider.value);
        this.dom.refractionValue.textContent = this.state.refraction;
        this.dom.magnificationValue.textContent = this.state.magnification;
        this.dom.dispersionValue.textContent = this.state.dispersion.toFixed(2);

        this.dom.lens.classList.toggle('dimmed', this.dom.dimmingToggle.checked);
        this.dom.lens.classList.toggle('reduce-motion', this.dom.reduceMotionToggle.checked);

        this.bindControls();
        this.bindTextTracking();
        this.bindImageTracking();
        
        this.updateActiveFilter();
    }

    // --- State Updaters ---

    updateActiveFilter() {
        const isImage = this.state.mode === 'image';
        const filterEl = document.getElementById(this.state.filter);
        if (!filterEl) return;

        const feImages = filterEl.querySelectorAll('feImage');
        const magnificationMap = feImages[0];
        const refractionMap = feImages[1];
        const feOffset = filterEl.querySelector('feOffset');

        if (magnificationMap && refractionMap) {
            magnificationMap.setAttribute('href', isImage ? './maps/displacement/magnification_circle.png' : './maps/displacement/magnification_pill.png');
            refractionMap.setAttribute('href', isImage ? './maps/displacement/refraction_circle.png' : './maps/displacement/refraction_pill.png');
            magnificationMap.setAttribute('height', isImage ? '100%' : '50%');
            refractionMap.setAttribute('height', isImage ? '100%' : '50%');
        }

        if (feOffset) feOffset.setAttribute('dy', isImage ? '0' : '-39');

        const url = `url(#${this.state.filter})`;
        this.dom.filterLayer.style.backdropFilter = url;
        this.dom.filterLayer.style.webkitBackdropFilter = url;

        this.updateDisplacement();
    }

    updateDisplacement() {
        const filterEl = document.getElementById(this.state.filter);
        if (!filterEl) return;

        const displacementMaps = Array.from(filterEl.querySelectorAll('feDisplacementMap'));

        const magnificationMap = displacementMaps.at(0);
        const refractionMaps = displacementMaps.slice(1);
        
        if (magnificationMap) {
            magnificationMap.setAttribute('scale', this.state.magnification);
        }

        const count = refractionMaps.length;
        refractionMaps.forEach((dm, index) => {
            const channelFactor = count > 1 ? index / (count - 1) : 1;
            const scale = this.state.refraction * (this.state.dispersion * channelFactor + (1 - this.state.dispersion));
            dm.setAttribute('scale', scale);
        });
    }

    scheduleHide() {
        clearTimeout(this.state.hideTimeout);
        this.state.hideTimeout = setTimeout(() => {
            this.dom.lens.classList.add('hidden');
        }, this.config.hideDelay);
    }

    // --- Control Preview Trigger ---

    triggerPreview() {
        clearTimeout(this.state.hideTimeout);

        if (this.state.mode === 'text') {
            const selection = window.getSelection();
            if (this.isSelectionInTextSandbox(selection)) {
                this.renderTextMagnifier();
            } else if (this.state.lastTextCoords) {
                this.setLensPosition(this.state.lastTextCoords.x, this.state.lastTextCoords.y);
            } else {
                // Fallback: preview over the center of the first paragraph
                const firstP = this.dom.textSandbox.querySelector('p');
                if (firstP) {
                    const rect = firstP.getBoundingClientRect();
                    const sandboxRect = this.dom.sandbox.getBoundingClientRect();
                    const x = rect.left + rect.width / 2 - sandboxRect.left;
                    const y = rect.top + 20 - sandboxRect.top - this.config.floatOffset;
                    this.setLensPosition(x, y);
                }
            }
        } else {
            if (this.state.lastImageCoords) {
                this.setLensPosition(this.state.lastImageCoords.x, this.state.lastImageCoords.y);
            } else {
                // Fallback: preview over the center of the image
                const imgRect = this.dom.sandboxImg.getBoundingClientRect();
                const sandboxRect = this.dom.sandbox.getBoundingClientRect();
                const x = imgRect.left + imgRect.width / 2 - sandboxRect.left;
                const y = imgRect.top + imgRect.height / 2 - sandboxRect.top - this.config.floatOffset;
                this.setLensPosition(x, y);
            }
        }

        this.scheduleHide();
    }

    setLensPosition(lensX, lensY) {
        this.dom.lens.style.transform = `translate3d(${lensX}px, ${lensY}px, 0) translateX(-50%)`;
        this.dom.lens.classList.remove('hidden');
    }

    // --- Control Panel Binding (Delegation & Events) ---

    bindControls() {
        // Theme Toggle
        document.getElementById('theme-toggle').addEventListener('click', (e) => {
            const isLight = document.body.classList.toggle('light-mode');
            e.currentTarget.textContent = isLight ? '☾' : '☼';
        });

        // Dimming & Motion Toggles
        this.dom.dimmingToggle.addEventListener('change', (e) => {
            this.dom.lens.classList.toggle('dimmed', e.target.checked);
            this.triggerPreview();
        });

        this.dom.reduceMotionToggle.addEventListener('change', (e) => {
            this.dom.lens.classList.toggle('reduce-motion', e.target.checked);
            this.triggerPreview();
        });

        // Sliders
        this.dom.magnificationSlider.addEventListener('input', (e) => {
            this.state.magnification = parseFloat(e.target.value);
            this.dom.magnificationValue.textContent = this.state.magnification;
            this.updateDisplacement();
            this.triggerPreview();
        });

        this.dom.refractionSlider.addEventListener('input', (e) => {
            this.state.refraction = parseFloat(e.target.value);
            this.dom.refractionValue.textContent = this.state.refraction;
            this.updateDisplacement();
            this.triggerPreview();
        });

        this.dom.dispersionSlider.addEventListener('input', (e) => {
            this.state.dispersion = parseFloat(e.target.value);
            this.dom.dispersionValue.textContent = this.state.dispersion.toFixed(2);
            this.updateDisplacement();
            this.triggerPreview();
        });

        // Button Groups via Event Delegation
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.panel-btn, .ribbon-btn');
            if (!btn) return;

            if (btn.classList.contains('ribbon-btn')) {
                this.handleRibbonSwitch(btn);
            } else if (btn.closest('#variant-group')) {
                this.handleVariantSwitch(btn);
            } else if (btn.closest('#filter-group')) {
                this.handleFilterSwitch(btn);
            }
        });
    }

    handleRibbonSwitch(btn) {
        document.querySelectorAll('.ribbon-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.state.mode = btn.dataset.mode;
        this.dom.lens.classList.add('hidden');

        const isImage = this.state.mode === 'image';
        this.dom.textSandbox.style.display = isImage ? 'none' : 'flex';
        this.dom.imageSandbox.style.display = isImage ? 'flex' : 'none';
        this.dom.lens.classList.toggle('shape-circle', isImage);
        
        this.updateActiveFilter();
        this.triggerPreview();
    }

    handleVariantSwitch(btn) {
        document.querySelectorAll('#variant-group .panel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        this.state.variant = btn.dataset.variant;
        this.dom.lens.classList.toggle('variant-clear', this.state.variant === 'clear');
        this.triggerPreview();
    }

    handleFilterSwitch(btn) {
        document.querySelectorAll('#filter-group .panel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        this.state.filter = btn.dataset.filter;
        this.updateActiveFilter();
        this.triggerPreview();
    }

    // --- Text Tracking ---

    isSelectionInTextSandbox(selection) {
        return (
            selection &&
            !selection.isCollapsed &&
            selection.rangeCount > 0 &&
            this.dom.textSandbox.contains(selection.focusNode)
        );
    }

    renderTextMagnifier = () => {
        this.state.rafId = null;
        const selection = window.getSelection();

        if (!this.isSelectionInTextSandbox(selection)) {
            this.dom.lens.classList.add('hidden');
            return;
        }

        const activeRange = document.createRange();
        activeRange.setStart(selection.focusNode, selection.focusOffset);
        activeRange.collapse(true);

        const activeRect = activeRange.getBoundingClientRect();
        const sandboxRect = this.dom.sandbox.getBoundingClientRect();

        if (activeRect.width === 0 && activeRect.height === 0 && activeRect.x === 0) {
            this.dom.lens.classList.add('hidden');
            return;
        }

        const lensX = activeRect.left - sandboxRect.left;
        const lensY = activeRect.top - sandboxRect.top - this.config.floatOffset;

        // Cache last valid position for previewing
        this.state.lastTextCoords = { x: lensX, y: lensY };
        this.setLensPosition(lensX, lensY);
    }

    scheduleTextUpdate = () => {
        if (this.state.mode === 'image') return;
        if (this.state.rafId !== null) return;
        this.state.rafId = requestAnimationFrame(this.renderTextMagnifier);
    }

    bindTextTracking() {
        this.dom.textSandbox.addEventListener('pointerdown', () => {
            if (this.state.mode === 'image') return;
            this.state.isSelecting = true;
            clearTimeout(this.state.hideTimeout);
        });

        document.addEventListener('pointermove', () => {
            if (this.state.mode === 'text' && this.state.isSelecting) {
                this.scheduleTextUpdate();
            }
        });

        document.addEventListener('pointerup', () => {
            if (this.state.mode === 'image' || !this.state.isSelecting) return;
            this.state.isSelecting = false;
            this.scheduleTextUpdate();
            this.scheduleHide();
        });

        document.addEventListener('selectionchange', () => {
            if (this.state.mode === 'text') {
                this.scheduleTextUpdate();
                if (!this.state.isSelecting) {
                    this.scheduleHide();
                }
            }
        });
    }

    // --- Image Tracking ---

    positionImageLens(clientX, clientY) {
        const sandboxRect = this.dom.sandbox.getBoundingClientRect();
        const lensX = clientX - sandboxRect.left;
        const lensY = clientY - sandboxRect.top - this.config.floatOffset;

        // Cache last valid position for previewing
        this.state.lastImageCoords = { x: lensX, y: lensY };
        this.setLensPosition(lensX, lensY);
    }

    bindImageTracking() {
        const stopImageInteraction = () => {
            if (!this.state.isImageInteracting || this.state.mode !== 'image') return;
            this.state.isImageInteracting = false;
            this.scheduleHide();
        };

        this.dom.imageSandbox.addEventListener('pointerdown', (e) => {
            if (this.state.mode !== 'image') return;
            this.dom.imageSandbox.setPointerCapture(e.pointerId);
            this.state.isImageInteracting = true;
            clearTimeout(this.state.hideTimeout);
            this.positionImageLens(e.clientX, e.clientY);
        });

        this.dom.imageSandbox.addEventListener('pointermove', (e) => {
            if (!this.state.isImageInteracting || this.state.mode !== 'image') return;
            this.positionImageLens(e.clientX, e.clientY);
        });

        this.dom.imageSandbox.addEventListener('pointerup', stopImageInteraction);
        this.dom.imageSandbox.addEventListener('pointercancel', stopImageInteraction);
    }
}

const app = new LensSandbox();