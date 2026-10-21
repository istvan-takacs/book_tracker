// Small DOM helpers shared by every view: safe HTML templating, icons,
// covers, toasts with Undo, and bottom sheets.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Raw HTML that `html` must not escape (only for markup we built). */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template: interpolations are escaped unless wrapped in raw() or are arrays of Raw. */
/** Only http(s) links from data; anything else (javascript:, data:) becomes inert. */
export function safeUrl(u) {
    try { const url = new URL(u, location.href); return /^https?:$/.test(url.protocol) ? url.href : '#'; } catch { return '#'; }
}

export function html(strings, ...vals) {
    let out = strings[0];
    vals.forEach((v, i) => {
        if (v instanceof Raw) out += v.s;
        else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
        else if (v === false || v == null) out += '';
        else out += esc(v);
        out += strings[i + 1];
    });
    return raw(out);
}

const PATHS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.6 4.6l3.4.9-3.9 14.9-3.4-.9z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    calendarAdd: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
    stats: '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    download: '<path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    torch: '<path d="M8 3h8l-1 6H9zM9 9l1 12h4l1-12M12 13v3"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    grid: '<rect x="4" y="4" width="6" height="7"/><rect x="14" y="4" width="6" height="7"/><rect x="4" y="14" width="6" height="7"/><rect x="14" y="14" width="6" height="7"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
};

export function icon(name, size = 22, label = null) {
    const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name] || ''}</svg>`);
}

/**
 * Cover URLs that have loaded at least once. Covers fade in the first time;
 * after that they render already visible, so re-renders never blink.
 */
export const loadedCovers = new Set();
if (typeof document !== 'undefined') {
    document.addEventListener('load', (e) => {
        const img = e.target;
        if (img?.tagName === 'IMG' && img.parentElement?.classList.contains('cover')) {
            img.classList.add('ready');
            loadedCovers.add(img.getAttribute('src'));
        }
    }, true);
}

const COVER_COLOURS = ['#2f5d62', '#6b3e5e', '#3d5a80', '#7a3b2e', '#4a3f6b', '#26303f', '#1f4e5f', '#556b3a', '#2e4a3a', '#7a5c24', '#2c4d6b', '#8a4b3a'];
function hash(s) { let h = 0; for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

/** A cover image, or a generated cover (title + author) when there is no image. */
export function cover(book, { size = 'md', label = true } = {}) {
    const title = book?.title || 'Untitled';
    const author = book?.authors?.[0]?.name || '';
    const bg = COVER_COLOURS[hash(title + author) % COVER_COLOURS.length];
    const alt = label ? `Cover of ${title}` : '';
    if (book?.coverUrl) {
        const ready = loadedCovers.has(book.coverUrl) ? ' class="ready"' : '';
        return html`<span class="cover cover-${size}" style="--cover-bg:${bg}"><img src="${book.coverUrl}" alt="${alt}"${raw(ready)} loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"><span class="cover-text" aria-hidden="true"><span class="cover-title">${title}</span><span class="cover-author">${author}</span></span></span>`;
    }
    return html`<span class="cover cover-${size}" style="--cover-bg:${bg}" ${raw(label ? `role="img" aria-label="${esc(alt)}"` : 'aria-hidden="true"')}><span class="cover-text"><span class="cover-title">${title}</span><span class="cover-author">${author}</span></span></span>`;
}

export function authorLink(author, cls = 'author-link') {
    if (!author?.name) return '';
    const target = author.id ? `#/author/hc_${author.id}` : `#/author/name/${encodeURIComponent(author.name)}`;
    return html`<a class="${cls}" href="${target}">${author.name}</a>`;
}

export function authorLinks(authors = [], cls) {
    return raw((authors || []).slice(0, 3).map((a) => authorLink(a, cls).toString()).join(', '));
}

export function seriesLabel(series) {
    if (!series?.name) return '';
    return series.position ? `${series.name}, book ${formatPosition(series.position)}` : series.name;
}

export function formatPosition(p) {
    return Number.isInteger(p) ? String(p) : String(p).replace(/\.0+$/, '');
}

// ─── Toasts ──────────────────────────────────────────────────────────
let toastTimer = null;
export function toast(message, { undo = null, duration = 5000 } = {}) {
    const host = document.getElementById('toast');
    clearTimeout(toastTimer);
    host.innerHTML = html`<span class="toast-msg">${message}</span>${undo ? html`<button type="button" class="toast-undo">Undo</button>` : ''}`.toString();
    host.hidden = false;
    host.classList.add('show');
    const hide = () => { host.classList.remove('show'); toastTimer = setTimeout(() => { host.hidden = true; }, 250); };
    if (undo) host.querySelector('.toast-undo').onclick = async () => { hide(); await undo(); };
    toastTimer = setTimeout(hide, duration);
}

// ─── Bottom sheets ───────────────────────────────────────────────────
let sheetCleanup = null;

/** Opens a sheet. `render(close)` returns {html, mount(el)}. Drag the handle or tap outside to close. */
export function openSheet({ label, content, mount, onClose, tall = false }) {
    closeSheet();
    const host = document.getElementById('sheet-host');
    host.innerHTML = html`<div class="sheet-backdrop" data-close></div><section class="sheet${tall ? ' sheet-tall' : ''}" role="dialog" aria-modal="true" aria-label="${label}"><button type="button" class="sheet-handle" aria-label="Close" data-close></button><div class="sheet-body">${content}</div></section>`.toString();
    host.hidden = false;
    document.body.classList.add('sheet-open');
    const sheet = host.querySelector('.sheet');
    requestAnimationFrame(() => host.classList.add('show'));
    const close = () => closeSheet();
    host.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    // drag the sheet down to dismiss
    let startY = null, dy = 0;
    const handle = sheet.querySelector('.sheet-handle');
    const down = (e) => { startY = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; sheet.style.transition = 'none'; };
    const move = (e) => {
        if (startY == null) return;
        dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - startY);
        sheet.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
        if (startY == null) return;
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (dy > 90) close();
        startY = null;
    };
    handle.addEventListener('touchstart', down, { passive: true });
    handle.addEventListener('pointerdown', down);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('pointermove', move);
    window.addEventListener('touchend', up);
    window.addEventListener('pointerup', up);

    sheetCleanup = () => {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('touchend', up);
        window.removeEventListener('pointerup', up);
        onClose?.();
    };
    const body = sheet.querySelector('.sheet-body');
    mount?.(body, close);
    sheet.querySelector('button:not(.sheet-handle), input, select, textarea, a')?.focus({ preventScroll: true });
    return close;
}

export function closeSheet() {
    const host = document.getElementById('sheet-host');
    if (!host || host.hidden) return;
    const cleanup = sheetCleanup;
    sheetCleanup = null;
    host.classList.remove('show');
    document.body.classList.remove('sheet-open');
    setTimeout(() => { if (!host.classList.contains('show')) { host.hidden = true; host.innerHTML = ''; } }, 220);
    cleanup?.();
}

/** Delegated handler: elements with data-action="name" call handlers[name](el, event). */
export function delegate(root, handlers, events = ['click']) {
    const listeners = events.map((type) => {
        const fn = (e) => {
            const el = e.target.closest('[data-action]');
            if (!el || !root.contains(el)) return;
            const actions = (el.dataset.on || 'click').split(' ');
            if (!actions.includes(type)) return;
            const h = handlers[el.dataset.action];
            if (h) { if (type === 'click' && el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault(); h(el, e); }
        };
        root.addEventListener(type, fn);
        return [type, fn];
    });
    return () => listeners.forEach(([t, fn]) => root.removeEventListener(t, fn));
}

export function plural(n, one, many = one + 's') {
    return `${n} ${n === 1 ? one : many}`;
}

export function fmtNumber(n) {
    return n == null ? '' : Number(n).toLocaleString('en-GB');
}

// ─── Updating the page in place ──────────────────────────────────────
// Re-rendering by replacing innerHTML recreates every element, so cover
// images blink, focus and scroll jump. morph() applies only the differences
// to the existing DOM: unchanged images, inputs and text stay untouched.

function sameNode(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    return a.tagName === b.tagName && (a.tagName !== 'IMG' || a.getAttribute('src') === b.getAttribute('src'));
}

function patchAttributes(from, to) {
    for (const { name } of [...from.attributes]) {
        if (!to.hasAttribute(name)) {
            // a loaded cover keeps its "ready" class
            if (from.tagName === 'IMG' && name === 'class' && from.classList.contains('ready')) continue;
            from.removeAttribute(name);
        }
    }
    for (const { name, value } of [...to.attributes]) {
        if (from.getAttribute(name) === value) continue;
        if (from.tagName === 'IMG' && name === 'class' && from.classList.contains('ready')) { from.setAttribute(name, value); from.classList.add('ready'); continue; }
        from.setAttribute(name, value);
    }
}

function patchFormValue(from, to) {
    if (document.activeElement === from) return; // never fight the reader's typing
    if (from.tagName === 'INPUT') {
        if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked');
        else if (from.value !== (to.getAttribute('value') ?? '')) from.value = to.getAttribute('value') ?? '';
    } else if (from.tagName === 'TEXTAREA') {
        if (from.value !== to.value) from.value = to.value;
    } else if (from.tagName === 'SELECT') {
        const i = [...to.options].findIndex((o) => o.hasAttribute('selected'));
        if (i >= 0 && from.selectedIndex !== i) from.selectedIndex = i;
    }
}

function patchChildren(from, to) {
    const next = [...to.childNodes];
    let i = 0;
    for (; i < next.length; i++) {
        const want = next[i];
        const have = from.childNodes[i];
        if (!have) { from.appendChild(want); continue; }
        if (!sameNode(have, want)) { from.replaceChild(want, have); continue; }
        if (have.nodeType !== 1) {
            if (have.nodeValue !== want.nodeValue) have.nodeValue = want.nodeValue;
            continue;
        }
        patchAttributes(have, want);
        if (have.tagName === 'IMG') continue;
        if (have.tagName === 'TEXTAREA') { patchFormValue(have, want); continue; }
        if (have.tagName !== 'INPUT') patchChildren(have, want);
        if (/^(INPUT|SELECT)$/.test(have.tagName)) patchFormValue(have, want);
    }
    while (from.childNodes.length > next.length) from.removeChild(from.lastChild);
}

/** Make `el`'s contents match `markup` while keeping unchanged nodes. */
export function morph(el, markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(markup);
    patchChildren(el, tpl.content);
}
