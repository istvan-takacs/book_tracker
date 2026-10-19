// Update-progress sheet: page, percent or audiobook time, all kept in step.

import { html, openSheet, cover } from '../ui.js';
import { describe, toFraction, stepFor, availableModes, formatDuration, clamp01 } from '../lib/progress.js';
import { updateProgress } from '../actions.js';
import { openRateSheet, listJoin } from './rate.js';
import { formatDay } from '../lib/dates.js';

const LABELS = { page: 'Page', percent: 'Percent', time: 'Audio time' };

export function openProgressSheet(book) {
    const dims = { pages: book.pageCount || null, audioSeconds: book.audioSeconds || null };
    const modes = availableModes(dims);
    let mode = modes.includes(book.progress?.mode) ? book.progress.mode : modes[0];
    let fraction = clamp01(book.progress?.fraction || 0);
    const current = (book.reads || []).at(-1);
    const hybrid = (current?.formats || []).length > 1;

    const values = () => {
        const d = describe(fraction, dims);
        if (mode === 'page') return { big: String(d.page), sub: `of ${dims.pages} pages · ${d.percent}%` };
        if (mode === 'time') return { big: formatDuration(d.audioSeconds), sub: `listened of ${formatDuration(dims.audioSeconds)} · ${d.percent}%${d.page != null ? ` · about page ${d.page}` : ''}` };
        return { big: `${d.percent}%`, sub: d.page != null ? `page ${d.page} of ${dims.pages}` : 'of the book' };
    };

    const content = html`
        <div class="row">
            ${cover(book, { size: 'sm', label: false })}
            <div class="grow"><h2 class="title-md">${book.title}</h2>
            <span class="small muted">${book.authors?.[0]?.name || ''}${current?.startedAt ? ` · started ${formatDay(current.startedAt, undefined, { weekday: false })}` : ''}</span></div>
        </div>
        ${hybrid ? html`<span class="small sage strong">Reading in ${listJoin(current.formats)} · every mode stays in step</span>` : ''}
        ${modes.length > 1 ? html`<div class="segmented" role="radiogroup" aria-label="Track by">${modes.map((m) => html`<button type="button" role="radio" data-mode="${m}" aria-checked="${String(m === mode)}">${LABELS[m]}</button>`)}</div>` : ''}
        <div class="stepper">
            <button type="button" class="btn btn-icon" data-step="-1" aria-label="Back a little">−</button>
            <div class="grow" style="text-align:center"><div class="big-value" data-big></div><div class="muted" data-sub></div></div>
            <button type="button" class="btn btn-icon" data-step="1" aria-label="Forward a little">+</button>
        </div>
        <label class="field">Drag to set progress<input type="range" min="0" max="1000" step="1" data-slider aria-label="Progress"></label>
        <label class="field"><span data-type-label></span><input class="input" type="number" inputmode="numeric" min="0" data-typed></label>
        <div class="row" style="display:grid;grid-template-columns:1fr 1fr">
            <button type="button" class="btn btn-outline btn-lg" data-finish>I finished it</button>
            <button type="button" class="btn btn-primary btn-lg" data-save>Save</button>
        </div>`;

    openSheet({
        label: `Update progress for ${book.title}`,
        content,
        mount(el, close) {
            const big = el.querySelector('[data-big]');
            const sub = el.querySelector('[data-sub]');
            const slider = el.querySelector('[data-slider]');
            let paint = () => {
                const v = values();
                big.textContent = v.big;
                sub.textContent = v.sub;
                big.style.fontSize = mode === 'time' ? '34px' : '';
                slider.value = String(Math.round(fraction * 1000));
                el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
            };
            paint();
            el.addEventListener('click', async (e) => {
                const t = e.target.closest('button');
                if (!t) return;
                if (t.dataset.mode) { mode = t.dataset.mode; paint(); }
                if (t.dataset.step) { fraction = clamp01(fraction + Number(t.dataset.step) * stepFor(mode, dims)); paint(); }
                if ('save' in t.dataset) { await updateProgress(book.key, fraction, mode); close(); }
                if ('finish' in t.dataset) { await updateProgress(book.key, 1, mode); close(); setTimeout(() => openRateSheet(book), 240); }
            });
            slider.addEventListener('input', () => { fraction = clamp01(Number(slider.value) / 1000); paint(); });
            // typing a value is quicker than dragging for long books
            const typed = el.querySelector('[data-typed]');
            const typeLabel = el.querySelector('[data-type-label]');
            const syncTyped = () => {
                const d = describe(fraction, dims);
                typeLabel.textContent = mode === 'page' ? 'Or type the page you are on' : mode === 'time' ? 'Or type minutes listened' : 'Or type a percentage';
                if (document.activeElement !== typed) typed.value = mode === 'page' ? d.page : mode === 'time' ? Math.round(d.audioSeconds / 60) : d.percent;
            };
            const basePaint = paint;
            paint = () => { basePaint(); syncTyped(); };
            syncTyped();
            typed.addEventListener('input', () => {
                const n = Number(typed.value);
                if (!Number.isFinite(n) || typed.value === '') return;
                fraction = toFraction(mode, mode === 'time' ? n * 60 : n, dims);
                basePaint();
            });
        },
    });
}

