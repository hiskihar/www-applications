'use strict';

/*
 * Benchmark harness for the SVG Liquid Glass loupe (RQ2 + RQ3).
 *
 * The filter graphs are generated here instead of being copied from index.html
 * so that every configuration and loupe size is built the same way. The graph
 * structure matches index.html: offset the content so the text under the caret
 * shows in the loupe, magnify, refract per colour band (geometric scale series),
 * add the bands back together, mask with the magnification map's alpha and
 * paste over the untouched content. The loupe is the demo's 107x79 shape; "size"
 * is the loupe width, and 107 px reproduces the demo exactly.
 *
 * Interactive use:  open benchmark.html, choose settings, press "Run benchmark".
 * Screenshot use:   benchmark.html?static=1&technique=content&config=disp-7
 *                   &size=214&bg=text-dark[&x=480&y=320]
 *                   -> sets <html data-ready="1"> when the frame is stable.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const MAPS = {
    magnification: './maps/displacement/magnification_v2.png',
    refraction: './maps/displacement/refraction_v2.png',
};

// Demo loupe geometry (style.css #lens-window, script.js LENS_WIDTH/LENS_HEIGHT).
const BASE_WIDTH = 107;
const BASE_HEIGHT = 79;

/** Loupe box and content offset for a given loupe width. */
function lensDims(size, params) {
    const s = size / BASE_WIDTH;
    return { w: size, h: BASE_HEIGHT * s, off: params.offset * s };
}

// Colour-band matrices copied from index.html.
const CHANNEL_MATRICES = {
    1: null, // no colour separation: a single refraction pass
    3: [
        '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
    ],
    5: [
        '.7 0 0 0 0  0 0  0 0 0  0 0 0  0 0  0 0 0 1 0',
        '.3 0 0 0 0  0 .2 0 0 0  0 0 0  0 0  0 0 0 1 0',
        '0  0 0 0 0  0 .6 0 0 0  0 0 0  0 0  0 0 0 1 0',
        '0  0 0 0 0  0 .2 0 0 0  0 0 .3 0 0  0 0 0 1 0',
        '0  0 0 0 0  0 0  0 0 0  0 0 .7 0 0  0 0 0 1 0',
    ],
    7: [
        '.44 0 0 0 0  0 0   0 0 0  0 0 0  0 0  0 0 0 1 0',
        '.35 0 0 0 0  0 .1  0 0 0  0 0 0  0 0  0 0 0 1 0',
        '.2  0 0 0 0  0 .25 0 0 0  0 0 0  0 0  0 0 0 1 0',
        '0   0 0 0 0  0 .4  0 0 0  0 0 0  0 0  0 0 0 1 0',
        '0   0 0 0 0  0 .2  0 0 0  0 0 .2 0 0  0 0 0 1 0',
        '0   0 0 0 0  0 .05 0 0 0  0 0 .4 0 0  0 0 0 1 0',
        '.01 0 0 0 0  0 0   0 0 0  0 0 .4 0 0  0 0 0 1 0',
    ],
};

// `magnify`: magnification displacement pass. `channels`: refraction bands (0 = no refraction).
const CONFIGS = [
    { id: 'none',   label: 'No filter (baseline)',                    magnify: false, channels: 0 },
    { id: 'mag',    label: 'Magnification only',                      magnify: true,  channels: 0 },
    { id: 'disp',   label: 'Magnification + refraction (1 channel)',  magnify: true,  channels: 1 },
    { id: 'disp-3', label: 'Magn. + refraction + dispersion 3',       magnify: true,  channels: 3 },
    { id: 'disp-5', label: 'Magn. + refraction + dispersion 5',       magnify: true,  channels: 5 },
    { id: 'disp-7', label: 'Magn. + refraction + dispersion 7',       magnify: true,  channels: 7 },
];
const CONFIG_BY_ID = Object.fromEntries(CONFIGS.map(c => [c.id, c]));
const SIZES = [107, 214, 321, 428]; // 1x-4x the demo loupe

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Deterministic PRNG so every engine/device sees the same "random" path. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(array, rng) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Percentile with linear interpolation between closest ranks (numpy default / type 7). */
function percentile(sorted, p) {
    if (sorted.length === 0) return NaN;
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

function median(values) {
    return percentile(values.slice().sort((a, b) => a - b), 0.5);
}

const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

// ---------------------------------------------------------------------------
// Filter graph construction
// ---------------------------------------------------------------------------

function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

/*
 * The map is sized in explicit user-space pixels. Percentages (as in index.html)
 * do not resolve to the loupe box under backdrop-filter in Blink once the loupe
 * is larger than ~185px, which leaves part of the loupe undisplaced.
 */
function feImage(href, result, w, h) {
    const el = svgEl('feImage', {
        href, result, x: 0, y: 0, width: +w.toFixed(3), height: +h.toFixed(3), preserveAspectRatio: 'none',
    });
    el.setAttributeNS(XLINK_NS, 'xlink:href', href); // older WebKit
    return el;
}

function feDisplacement(input, map, scale, result) {
    return svgEl('feDisplacementMap', {
        in: input, in2: map, scale: +scale.toFixed(3),
        xChannelSelector: 'R', yChannelSelector: 'G', result,
    });
}

/**
 * Builds the filter for a configuration at a given loupe width, following index.html.
 * Displacement scales are in user-space pixels; with `scaleWithSize` they are
 * multiplied by size / 107 so a larger loupe looks the same, just bigger.
 *
 * `region` null: the filter is applied to a loupe-sized element (backdrop / portal);
 * the element is the loupe box extended downwards by the content offset, so the
 * feOffset has the content below the loupe to pull up, as in the demo.
 * `region` {w, h}: the filter is applied to the whole content (as in the demo);
 * the feImage x/y are moved to the loupe position every frame by Bench#setLens.
 */
function buildFilter(id, config, size, params, region = null) {
    const filter = svgEl('filter', {
        id,
        ...(region
            ? { filterUnits: 'userSpaceOnUse', x: 0, y: 0, width: region.w, height: region.h }
            : { x: 0, y: 0, width: '100%', height: '100%' }),
        primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'linearRGB',
    });

    const { w, h, off } = lensDims(size, params);
    const k = params.scaleWithSize ? size / BASE_WIDTH : 1;

    // The magnification map's alpha is the loupe shape; it masks every configuration.
    filter.append(feImage(MAPS.magnification, 'magnificationMap', w, h));
    if (config.channels > 0) filter.append(feImage(MAPS.refraction, 'refractionMap', w, h));

    filter.append(svgEl('feOffset', { in: 'SourceGraphic', dy: +(-off).toFixed(3), result: 'shifted' }));
    let src = 'shifted';

    if (config.magnify) {
        filter.append(feDisplacement(src, 'magnificationMap', params.magnification * k, 'magnified'));
        src = 'magnified';
    }

    if (config.channels > 0) {
        // Geometric series centred on the refraction scale, as in index.html:
        // 7 bands = refraction * r^-3 ... r^3; 3 and 5 bands span the same range.
        const n = config.channels;
        const refractionScale = i => {
            const exponent = n > 1 ? 3 * (2 * i / (n - 1) - 1) : 0;
            return params.refraction * params.dispersion ** exponent * k;
        };

        if (n === 1) {
            filter.append(feDisplacement(src, 'refractionMap', refractionScale(0), 'refracted'));
            src = 'refracted';
        } else {
            const matrices = CHANNEL_MATRICES[n];
            matrices.forEach((values, i) => {
                filter.append(svgEl('feColorMatrix', { in: src, type: 'matrix', values, result: `c${i}` }));
            });
            matrices.forEach((_, i) => {
                filter.append(feDisplacement(`c${i}`, 'refractionMap', refractionScale(i), `d${i}`));
            });
            const add = (a, b) => svgEl('feComposite', {
                in: a, in2: b, operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'composite',
            });
            filter.append(add('d0', 'd1'));
            for (let i = 2; i < n; i++) filter.append(add('composite', `d${i}`));
            src = 'composite';
        }
    }

    filter.append(svgEl('feComposite', { in: src, in2: 'magnificationMap', operator: 'in', result: 'lens_content' }));
    filter.append(svgEl('feComposite', { in: 'lens_content', in2: 'SourceGraphic', operator: 'over' }));
    return filter;
}

/** Complexity factors used in RQ2. */
function complexityOf(config, size, settings, dpr, sandbox) {
    if (config.id === 'none') {
        return { primitives: 0, displacementPasses: 0, areaCss: 0, areaDevice: 0 };
    }
    const filter = buildFilter('tmp', config, size, { ...settings, scaleWithSize: false });
    const { w, h, off } = lensDims(size, settings);
    // Filter region: the whole content for 'content', otherwise the loupe box plus the offset strip.
    const areaCss = settings.technique === 'content' ? sandbox.w * sandbox.h : Math.round(w * (h + off));
    return {
        primitives: filter.children.length,
        displacementPasses: filter.querySelectorAll('feDisplacementMap').length,
        areaCss,
        areaDevice: Math.round(areaCss * dpr * dpr),
    };
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function detectBrowser() {
    const ua = navigator.userAgent;
    let m;
    // Every iOS/iPadOS browser uses WebKit, whatever its name. iPadOS reports a Mac UA, hence the touch check.
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (isIOS) {
        if ((m = ua.match(/CriOS\/([\d.]+)/))) return { browser: 'Chrome iOS', version: m[1], engine: 'WebKit' };
        if ((m = ua.match(/FxiOS\/([\d.]+)/))) return { browser: 'Firefox iOS', version: m[1], engine: 'WebKit' };
        if ((m = ua.match(/EdgiOS\/([\d.]+)/))) return { browser: 'Edge iOS', version: m[1], engine: 'WebKit' };
        m = ua.match(/Version\/([\d.]+)/);
        return { browser: 'Safari iOS', version: m ? m[1] : '', engine: 'WebKit' };
    }
    if ((m = ua.match(/Firefox\/([\d.]+)/))) return { browser: 'Firefox', version: m[1], engine: 'Gecko' };
    if ((m = ua.match(/Edg\/([\d.]+)/))) return { browser: 'Edge', version: m[1], engine: 'Blink' };
    if ((m = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/))) return { browser: 'Chrome', version: m[1], engine: 'Blink' };
    if ((m = ua.match(/Version\/([\d.]+).*Safari/))) return { browser: 'Safari', version: m[1], engine: 'WebKit' };
    return { browser: 'unknown', version: '', engine: 'unknown' };
}

function gpuRenderer() {
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        if (!gl) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch {
        return null;
    }
}

async function batteryInfo() {
    try {
        if (!navigator.getBattery) return null;
        const b = await navigator.getBattery();
        return { charging: b.charging, level: b.level };
    } catch {
        return null;
    }
}

async function collectEnvironment() {
    const env = {
        ...detectBrowser(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemory: navigator.deviceMemory ?? null,
        devicePixelRatio: window.devicePixelRatio,
        screen: `${screen.width}x${screen.height}`,
        viewport: `${innerWidth}x${innerHeight}`,
        gpu: gpuRenderer(),
        battery: await batteryInfo(),
        // Parse-level support only: an engine may accept the value but not render it.
        cssSupportsBackdropUrl: CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)'),
        cssSupportsFilterUrl: CSS.supports('filter', 'url(#x)'),
    };
    if (navigator.userAgentData?.getHighEntropyValues) {
        try {
            const h = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'model', 'architecture', 'fullVersionList']);
            env.uaData = { platform: h.platform, platformVersion: h.platformVersion, model: h.model, architecture: h.architecture, fullVersionList: h.fullVersionList };
        } catch { /* ignore */ }
    }
    return env;
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

class Bench {
    constructor() {
        this.dom = {
            form: document.getElementById('settings'),
            sandbox: document.getElementById('sandbox'),
            bg: document.getElementById('bg'),
            lens: document.getElementById('lens'),
            backdrop: document.querySelector('.lens-backdrop'),
            portal: document.querySelector('.lens-portal'),
            portalContent: document.querySelector('.portal-content'),
            filterHost: document.getElementById('filter-host'),
            status: document.getElementById('status'),
            env: document.getElementById('env'),
            run: document.getElementById('btn-run'),
            stop: document.getElementById('btn-stop'),
            refresh: document.getElementById('btn-refresh'),
            json: document.getElementById('btn-json'),
            csv: document.getElementById('btn-csv'),
            previewConfig: document.getElementById('preview-config'),
            previewSize: document.getElementById('preview-size'),
            summary: document.getElementById('summary-table'),
            cells: document.getElementById('cells-table'),
            maxDiameter: document.getElementById('max-diameter'),
        };
        this.filterCounter = 0;
        this.running = false;
        this.aborted = false;
        this.hiddenDuringCell = false;
        this.results = null;
        this.refreshMs = null;
        this.current = null; // { config, size, technique, cssAccepted }
        this.lensCentre = null;

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.hiddenDuringCell = true;
        });
    }

    async init() {
        const params = new URLSearchParams(location.search);
        this.buildChoiceLists();
        await Promise.all([inlineMaps(), preload('aalto.jpg')]);

        if (params.has('static')) {
            await this.initStatic(params);
            return;
        }

        this.bindUi();
        this.updateTechniqueWarning();
        this.applyBackground();
        this.preview();
        this.env = await collectEnvironment();
        this.renderEnv();
    }

    // --- Settings ---------------------------------------------------------

    buildChoiceLists() {
        const configList = document.getElementById('config-list');
        const sizeList = document.getElementById('size-list');
        for (const c of CONFIGS) {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" name="config" value="${c.id}" checked /> ${c.label}`;
            configList.append(label);
            this.dom.previewConfig.append(new Option(c.label, c.id));
        }
        for (const s of SIZES) {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" name="size" value="${s}" checked /> ${s}`;
            sizeList.append(label);
            this.dom.previewSize.append(new Option(`${s}px`, s));
        }
        this.dom.previewConfig.value = 'disp-7'; // the demo's default filter
        this.dom.previewSize.value = '214';
    }

    readSettings() {
        const f = new FormData(this.dom.form);
        const num = name => parseFloat(f.get(name));
        return {
            technique: f.get('technique'),
            background: f.get('background'),
            magnification: num('magnification'),
            refraction: num('refraction'),
            dispersion: num('dispersion'),
            offset: num('offset'),
            scaleWithSize: f.get('scaleWithSize') === 'on',
            configs: f.getAll('config'),
            sizes: f.getAll('size').map(Number),
            path: f.get('path'),
            jitter: num('jitter'),
            seed: Math.trunc(num('seed')),
            duration: num('duration'),
            warmup: Math.trunc(num('warmup')),
            repetitions: Math.trunc(num('repetitions')),
            cooldown: num('cooldown'),
            refreshHz: num('refreshHz'),
            budgetFactor: num('budgetFactor'),
            holdsPct: num('holdsPct'),
            device: f.get('device'),
            hardware: f.get('hardware'),
            os: f.get('os'),
            display: f.get('display'),
            notes: f.get('notes'),
        };
    }

    // --- Scene ------------------------------------------------------------

    applyBackground(name = this.readSettings().background) {
        const bg = this.dom.bg;
        bg.className = 'bg';
        bg.replaceChildren();
        if (name === 'image') {
            const img = document.createElement('img');
            img.src = 'aalto.jpg';
            img.alt = '';
            img.draggable = false;
            bg.append(img);
        } else if (name.startsWith('text')) {
            bg.classList.add('text', name);
            const tpl = document.getElementById('lorem').content;
            bg.append(tpl.cloneNode(true), tpl.cloneNode(true)); // twice, to fill large sandboxes
        } else {
            bg.classList.add(name);
        }
        // The portal technique renders its own copy of the background.
        this.dom.portalContent.className = bg.className + ' portal-content';
        this.dom.portalContent.replaceChildren(...Array.from(bg.childNodes, n => n.cloneNode(true)));
    }

    /** Applies config + size + technique. Builds a fresh filter id so no stale filter is reused. */
    applyConfig(configId, size, settings) {
        const config = CONFIG_BY_ID[configId];
        const { lens, backdrop, portal, bg, filterHost } = this.dom;
        const technique = settings.technique;
        const sandbox = this.sandboxSize();
        const dims = lensDims(size, settings);

        filterHost.replaceChildren();
        let url = 'none';
        let mapNodes = [];
        if (config.id !== 'none') {
            const id = `bench-filter-${++this.filterCounter}`;
            const filter = buildFilter(id, config, size, settings, technique === 'content' ? sandbox : null);
            filterHost.append(filter);
            url = `url(#${id})`;
            if (technique === 'content') mapNodes = Array.from(filter.querySelectorAll('feImage'));
        }

        lens.dataset.technique = technique;
        // Only backdrop-filter needs the sandbox to be a Backdrop Root (filter: blur(0)). For the other
        // techniques it would just add a full-sandbox filter pass to every frame in every configuration.
        this.dom.sandbox.classList.toggle('backdrop-root', technique === 'backdrop');
        lens.style.width = `${dims.w}px`;
        lens.style.height = `${dims.h}px`;
        // Backdrop / portal boxes extend below the loupe by the offset so feOffset has content to pull up.
        for (const el of [backdrop, portal]) {
            el.style.width = `${dims.w}px`;
            el.style.height = `${dims.h + dims.off}px`;
        }
        // The portal copy must have the sandbox's dimensions so its layout matches the real content.
        this.dom.portalContent.style.width = `${sandbox.w}px`;
        this.dom.portalContent.style.height = `${sandbox.h}px`;

        backdrop.style.backdropFilter = '';
        backdrop.style.webkitBackdropFilter = '';
        portal.style.filter = '';
        bg.style.filter = '';
        const target = { backdrop, portal, content: bg }[technique];
        if (technique === 'backdrop') {
            backdrop.style.backdropFilter = url;
            backdrop.style.webkitBackdropFilter = url;
        } else {
            target.style.filter = url;
        }

        // Record whether the engine accepted the declared value at all (parse level).
        const cs = getComputedStyle(target);
        const applied = technique === 'backdrop'
            ? (cs.backdropFilter || cs.webkitBackdropFilter || 'none')
            : cs.filter;
        this.current = { config, size, technique, dims, mapNodes, cssAccepted: url === 'none' || applied !== 'none' };
        lens.hidden = false;
        return this.current;
    }

    /** Positions the loupe centre at (x, y) in sandbox coordinates. */
    setLens(x, y) {
        this.lensCentre = { x, y };
        const { w, h } = this.current.dims;
        const left = Math.round(x - w / 2);
        const top = Math.round(y - h / 2);
        this.dom.lens.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        if (this.current.technique === 'portal') {
            this.dom.portalContent.style.transform = `translate3d(${-left}px, ${-top}px, 0)`;
        }
        // 'content' technique: move the maps to the loupe, as script.js does.
        for (const node of this.current.mapNodes) {
            node.setAttribute('x', left);
            node.setAttribute('y', top);
        }
    }

    /** Range of loupe centres that keeps the loupe and the content it shows inside the sandbox. */
    centreRange(size, settings) {
        const { w: W, h: H } = this.sandboxSize();
        const { w, h, off } = lensDims(size, settings);
        const xMin = w / 2, xMax = Math.max(xMin, W - w / 2);
        const yMin = h / 2, yMax = Math.max(yMin, H - h / 2 - off);
        return { xMin, xMax, yMin, yMax };
    }

    sandboxSize() {
        return { w: this.dom.sandbox.clientWidth, h: this.dom.sandbox.clientHeight };
    }

    /** Returns a function t(ms) -> {x, y} for the configured path. */
    makePath(settings, size) {
        const { xMin, xMax, yMin, yMax } = this.centreRange(size, settings);
        const rng = mulberry32(settings.seed);
        const clampX = x => Math.min(Math.max(x, xMin), xMax);
        const clampY = y => Math.min(Math.max(y, yMin), yMax);
        const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
        const ax = (xMax - xMin) / 2, ay = (yMax - yMin) / 2;

        if (settings.path === 'random') {
            return () => ({ x: xMin + rng() * (xMax - xMin), y: yMin + rng() * (yMax - yMin) });
        }
        const jitter = settings.path === 'jitter' ? settings.jitter : 0;
        return t => {
            const s = t / 1000;
            let x = cx + ax * Math.sin(2 * Math.PI * 0.31 * s);
            let y = cy + ay * Math.sin(2 * Math.PI * 0.47 * s + Math.PI / 3);
            if (jitter) {
                x += (rng() * 2 - 1) * jitter;
                y += (rng() * 2 - 1) * jitter;
            }
            return { x: clampX(x), y: clampY(y) };
        };
    }

    // --- Measurement ------------------------------------------------------

    /** Median rAF interval with an idle scene; used as the display refresh interval. */
    async measureRefresh(frames = 180) {
        const hadLens = !this.dom.lens.hidden;
        this.dom.lens.hidden = true;
        await nextFrame();
        await nextFrame();
        const stamps = [];
        for (let i = 0; i <= frames; i++) stamps.push(await nextFrame());
        this.dom.lens.hidden = !hadLens;
        const intervals = stamps.slice(1).map((t, i) => t - stamps[i]);
        return median(intervals);
    }

    /** Runs one cell and returns raw frame intervals (warm-up frames removed). */
    measureCell(settings, size) {
        const path = this.makePath(settings, size);
        const warmup = settings.warmup;
        const durationMs = settings.duration * 1000;
        const stamps = [];

        return new Promise(resolve => {
            let start = null;
            const tick = ts => {
                if (start === null) start = ts;
                stamps.push(ts);
                const done = this.aborted ||
                    (stamps.length > warmup && ts - stamps[warmup] >= durationMs);
                if (done) {
                    const measured = stamps.slice(warmup);
                    resolve(measured.slice(1).map((t, i) => t - measured[i]));
                    return;
                }
                const p = path(ts - start);
                this.setLens(p.x, p.y);
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    stats(intervals, refreshMs, budgetFactor) {
        const sorted = intervals.slice().sort((a, b) => a - b);
        const n = sorted.length;
        const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : NaN;
        const sd = n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
        const budget = refreshMs * budgetFactor;
        const over = intervals.filter(v => v > budget).length;
        const dropped = intervals.reduce((acc, v) => acc + Math.max(0, Math.round(v / refreshMs) - 1), 0);
        return {
            frames: n,
            meanMs: mean,
            sdMs: sd,
            p50Ms: percentile(sorted, 0.5),
            p95Ms: percentile(sorted, 0.95),
            p99Ms: percentile(sorted, 0.99),
            maxMs: sorted[n - 1],
            fps: 1000 / mean,
            budgetMs: budget,
            overBudget: over,
            overBudgetPct: n ? (over / n) * 100 : NaN,
            droppedFramesEst: dropped,
        };
    }

    async run() {
        const settings = this.readSettings();
        if (!settings.configs.length || !settings.sizes.length) {
            this.setStatus('Select at least one configuration and one diameter.');
            return;
        }
        this.running = true;
        this.aborted = false;
        this.setRunningUi(true);
        this.applyBackground(settings.background);
        this.env = await collectEnvironment();
        this.renderEnv();

        this.setStatus('Measuring refresh rate…');
        const measuredRefreshMs = await this.measureRefresh();
        this.refreshMs = settings.refreshHz > 0 ? 1000 / settings.refreshHz : measuredRefreshMs;

        const startedAt = new Date().toISOString();
        const sandbox = this.sandboxSize();
        const cells = [];
        this.results = {
            schema: 'loupe-benchmark/1',
            startedAt,
            finishedAt: null,
            environment: this.env,
            settings,
            sandbox,
            measuredRefreshMs,
            refreshMs: this.refreshMs,
            refreshHz: 1000 / this.refreshMs,
            batteryStart: this.env.battery,
            batteryEnd: null,
            cells,
        };

        const grid = [];
        for (const c of settings.configs) for (const s of settings.sizes) grid.push({ config: c, size: s });
        const orderRng = mulberry32(settings.seed ^ 0x9e3779b9);
        const total = grid.length * settings.repetitions;
        let index = 0;

        outer:
        for (let rep = 1; rep <= settings.repetitions; rep++) {
            const order = shuffle(grid, orderRng);
            for (const { config, size } of order) {
                if (this.aborted) break outer;
                index++;
                this.setStatus(`Rep ${rep}/${settings.repetitions} · cell ${index}/${total} · ${CONFIG_BY_ID[config].label} @ ${size}px`);

                const applied = this.applyConfig(config, size, settings);
                const start = this.makePath(settings, size)(0);
                this.setLens(start.x, start.y);
                await sleep(settings.cooldown);
                await nextFrame();

                this.hiddenDuringCell = document.hidden;
                const intervals = await this.measureCell(settings, size);
                if (this.aborted) break outer;

                cells.push({
                    order: index,
                    repetition: rep,
                    config,
                    configLabel: CONFIG_BY_ID[config].label,
                    size,
                    technique: settings.technique,
                    background: settings.background,
                    cssAccepted: applied.cssAccepted,
                    valid: !this.hiddenDuringCell,
                    ...complexityOf(CONFIG_BY_ID[config], size, settings, this.env.devicePixelRatio, sandbox),
                    ...this.stats(intervals, this.refreshMs, settings.budgetFactor),
                    intervals: intervals.map(v => +v.toFixed(3)),
                });
                this.renderCells();
            }
        }

        this.results.finishedAt = new Date().toISOString();
        this.results.batteryEnd = await batteryInfo();
        this.results.summary = this.summarize();
        this.renderSummary();
        this.dom.lens.hidden = true;
        this.running = false;
        this.setRunningUi(false);
        this.setStatus(this.aborted
            ? `Stopped after ${cells.length} cells.`
            : `Done: ${cells.length} cells, refresh ${fmt(1000 / this.refreshMs, 1)} Hz (budget ${fmt(this.refreshMs * settings.budgetFactor)} ms).`);
        window.__benchResults = this.results; // for automation
    }

    /** Pools valid cells per config × size across repetitions. */
    summarize() {
        const { settings, cells, sandbox } = this.results;
        const rows = [];
        for (const config of settings.configs) {
            for (const size of settings.sizes) {
                const group = cells.filter(c => c.config === config && c.size === size && c.valid);
                if (!group.length) continue;
                const pooled = group.flatMap(c => c.intervals);
                const s = this.stats(pooled, this.refreshMs, settings.budgetFactor);
                rows.push({
                    config,
                    configLabel: CONFIG_BY_ID[config].label,
                    size,
                    repetitions: group.length,
                    ...complexityOf(CONFIG_BY_ID[config], size, settings, this.env.devicePixelRatio, sandbox),
                    ...s,
                    holdsBudget: s.overBudgetPct <= settings.holdsPct,
                });
            }
        }
        // Largest diameter at which a config holds the budget (and every smaller tested size does too).
        const maxDiameter = {};
        for (const config of settings.configs) {
            let best = null;
            for (const size of settings.sizes.slice().sort((a, b) => a - b)) {
                const row = rows.find(r => r.config === config && r.size === size);
                if (!row || !row.holdsBudget) break;
                best = size;
            }
            maxDiameter[config] = best;
        }
        return { rows, maxDiameter };
    }

    // --- Static mode (screenshots for RQ1/RQ3) ----------------------------

    async initStatic(params) {
        document.body.classList.add('static');
        const settings = {
            ...this.readSettings(),
            technique: params.get('technique') || 'content',
            background: params.get('bg') || 'text-dark',
        };
        for (const key of ['magnification', 'refraction', 'dispersion', 'offset']) {
            if (params.has(key)) settings[key] = parseFloat(params.get(key));
        }
        const size = parseInt(params.get('size') || '214', 10);
        this.applyBackground(settings.background);
        this.applyConfig(params.get('config') || 'disp-7', size, settings);
        const r = this.centreRange(size, settings);
        const x = params.has('x') ? parseFloat(params.get('x')) : (r.xMin + r.xMax) / 2;
        const y = params.has('y') ? parseFloat(params.get('y')) : (r.yMin + r.yMax) / 2;
        this.setLens(x, y);
        await Promise.all(Array.from(document.images, img => img.decode().catch(() => {})));
        for (let i = 0; i < 5; i++) await nextFrame();
        const { w, h } = this.current.dims;
        document.documentElement.dataset.ready = '1';
        document.documentElement.dataset.lens = JSON.stringify({
            x, y, size, w, h, left: Math.round(x - w / 2), top: Math.round(y - h / 2),
            cssAccepted: this.current.cssAccepted,
        });
    }

    // --- UI ---------------------------------------------------------------

    bindUi() {
        this.dom.run.addEventListener('click', () => this.run());
        this.dom.stop.addEventListener('click', () => { this.aborted = true; });
        this.dom.refresh.addEventListener('click', async () => {
            this.setStatus('Measuring refresh rate…');
            const ms = await this.measureRefresh();
            this.setStatus(`Median rAF interval ${fmt(ms)} ms ≈ ${fmt(1000 / ms, 1)} Hz`);
        });
        this.dom.json.addEventListener('click', () => this.exportJson());
        this.dom.csv.addEventListener('click', () => this.exportCsv());
        this.dom.form.addEventListener('change', e => {
            if (e.target.name === 'background') this.applyBackground();
            if (e.target.name === 'technique') this.updateTechniqueWarning();
            if (!this.running) this.preview();
        });
        this.dom.previewConfig.addEventListener('change', () => this.preview());
        this.dom.previewSize.addEventListener('change', () => this.preview());

        // Drag to preview (qualitative inspection for RQ1). As in the demo, the loupe floats
        // above the pointer and shows the content under it.
        const sandbox = this.dom.sandbox;
        let dragging = false;
        const move = e => {
            const r = sandbox.getBoundingClientRect();
            this.setLens(e.clientX - r.left, e.clientY - r.top - this.current.dims.off);
        };
        sandbox.addEventListener('pointerdown', e => {
            if (this.running) return;
            dragging = true;
            sandbox.setPointerCapture(e.pointerId);
            this.preview();
            move(e);
        });
        sandbox.addEventListener('pointermove', e => { if (dragging && !this.running) move(e); });
        const end = () => { dragging = false; };
        sandbox.addEventListener('pointerup', end);
        sandbox.addEventListener('pointercancel', end);
    }

    preview() {
        if (this.running) return;
        const settings = this.readSettings();
        const size = parseInt(this.dom.previewSize.value, 10);
        const r = this.centreRange(size, settings);
        const centre = this.lensCentre ?? { x: (r.xMin + r.xMax) / 2, y: (r.yMin + r.yMax) / 2 };
        this.applyConfig(this.dom.previewConfig.value, size, settings);
        this.setLens(centre.x, centre.y);
    }

    updateTechniqueWarning() {
        const backdrop = this.dom.form.elements.technique.value === 'backdrop';
        document.getElementById('technique-warning').hidden = !(backdrop && detectBrowser().engine !== 'Blink');
    }

    setRunningUi(running) {
        for (const el of this.dom.form.elements) el.disabled = running;
        this.dom.previewConfig.disabled = this.dom.previewSize.disabled = running;
        this.dom.run.disabled = running;
        this.dom.refresh.disabled = running;
        this.dom.stop.disabled = !running;
        this.dom.json.disabled = this.dom.csv.disabled = running || !this.results;
    }

    setStatus(text) {
        this.dom.status.textContent = text;
    }

    renderEnv() {
        const e = this.env;
        this.dom.env.textContent =
            `${e.browser} ${e.version} (${e.engine}) · DPR ${e.devicePixelRatio} · screen ${e.screen} · ` +
            `${e.hardwareConcurrency ?? '?'} threads · GPU: ${e.gpu ?? 'n/a'} · ` +
            `battery: ${e.battery ? (e.battery.charging ? 'charging' : 'ON BATTERY') + ` ${Math.round(e.battery.level * 100)}%` : 'n/a'} · ` +
            `CSS.supports backdrop-filter:url(): ${e.cssSupportsBackdropUrl}`;
    }

    renderCells() {
        const head = ['#', 'Rep', 'Config', 'Ø px', 'Prim.', 'Displ.', 'Area (dev px)', 'Frames', 'p50 ms', 'p95 ms', 'p99 ms', 'Max ms', 'Over %', 'Dropped', 'CSS ok'];
        const rows = this.results.cells.map(c => {
            const cls = !c.valid ? 'invalid' : '';
            return `<tr class="${cls}"><td>${c.order}</td><td>${c.repetition}</td><td class="left">${c.configLabel}</td><td>${c.size}</td>` +
                `<td>${c.primitives}</td><td>${c.displacementPasses}</td><td>${c.areaDevice.toLocaleString()}</td><td>${c.frames}</td>` +
                `<td>${fmt(c.p50Ms)}</td><td>${fmt(c.p95Ms)}</td><td>${fmt(c.p99Ms)}</td><td>${fmt(c.maxMs)}</td>` +
                `<td>${fmt(c.overBudgetPct, 1)}</td><td>${c.droppedFramesEst}</td><td>${c.cssAccepted ? 'yes' : 'no'}</td></tr>`;
        });
        this.dom.cells.innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
    }

    renderSummary() {
        const { rows, maxDiameter } = this.results.summary;
        const head = ['Config', 'Ø px', 'Reps', 'Prim.', 'Displ.', 'Area (dev px)', 'Frames', 'p50 ms', 'p95 ms', 'p99 ms', 'Over %', 'Holds budget'];
        const body = rows.map(r =>
            `<tr class="${r.holdsBudget ? '' : 'fail'}"><td class="left">${r.configLabel}</td><td>${r.size}</td><td>${r.repetitions}</td>` +
            `<td>${r.primitives}</td><td>${r.displacementPasses}</td><td>${r.areaDevice.toLocaleString()}</td><td>${r.frames}</td>` +
            `<td>${fmt(r.p50Ms)}</td><td>${fmt(r.p95Ms)}</td><td>${fmt(r.p99Ms)}</td><td>${fmt(r.overBudgetPct, 1)}</td>` +
            `<td>${r.holdsBudget ? 'yes' : 'no'}</td></tr>`);
        this.dom.summary.innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody>`;
        this.dom.maxDiameter.innerHTML = '<h2>Largest diameter holding the budget</h2><ul>' +
            Object.entries(maxDiameter).map(([id, d]) => `<li>${CONFIG_BY_ID[id].label}: ${d ? d + ' px' : 'none of the tested sizes'}</li>`).join('') +
            '</ul>';
    }

    // --- Export -----------------------------------------------------------

    fileStem() {
        const e = this.results.environment;
        const stamp = this.results.startedAt.replace(/[:.]/g, '-').slice(0, 19);
        const device = (this.results.settings.device || 'device').replace(/[^\w-]+/g, '_');
        return `bench_${e.browser}-${e.version.split('.')[0]}_${device}_${this.results.settings.technique}_${stamp}`;
    }

    exportJson() {
        download(`${this.fileStem()}.json`, JSON.stringify(this.results, null, 1), 'application/json');
    }

    /** One row per cell; environment columns repeated so CSVs from different runs can be concatenated. */
    exportCsv() {
        const r = this.results;
        const e = r.environment;
        const s = r.settings;
        const envCols = {
            browser: e.browser, browserVersion: e.version, engine: e.engine,
            device: s.device, hardware: s.hardware, os: s.os, display: s.display, notes: s.notes,
            gpu: e.gpu, dpr: e.devicePixelRatio, refreshHz: r.refreshHz.toFixed(2),
            sandbox: `${r.sandbox.w}x${r.sandbox.h}`, path: s.path, startedAt: r.startedAt,
        };
        const cellCols = ['order', 'repetition', 'config', 'size', 'technique', 'background', 'cssAccepted', 'valid',
            'primitives', 'displacementPasses', 'areaCss', 'areaDevice', 'frames', 'meanMs', 'sdMs', 'p50Ms', 'p95Ms',
            'p99Ms', 'maxMs', 'fps', 'budgetMs', 'overBudget', 'overBudgetPct', 'droppedFramesEst'];
        const header = [...Object.keys(envCols), ...cellCols];
        const lines = [header.join(',')];
        for (const c of r.cells) {
            const vals = [...Object.values(envCols), ...cellCols.map(k => (typeof c[k] === 'number' ? +c[k].toFixed(4) : c[k]))];
            lines.push(vals.map(csvEscape).join(','));
        }
        download(`${this.fileStem()}.csv`, lines.join('\n'), 'text/csv');
    }
}

function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Replaces the map URLs with data: URIs. feImage then needs no network load, which
 * removes a common failure point in WebKit and makes the maps available on the first
 * frame in every engine. Falls back to the file URL if fetching fails.
 */
async function inlineMaps() {
    await Promise.all(Object.keys(MAPS).map(async key => {
        try {
            const blob = await (await fetch(MAPS[key])).blob();
            MAPS[key] = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch {
            /* keep the file URL */
        }
    }));
}

function preload(src) {
    const img = new Image();
    img.src = src;
    return img.decode().catch(() => {});
}

window.bench = new Bench();
window.bench.init();