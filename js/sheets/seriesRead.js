// "Mark books as read" for a whole series you read in the past: pick the
// books, give one rating (or none), say roughly when, then fine-tune each
// book's rating on the next step.

import { html, openSheet, raw, cover } from '../ui.js';
import { store } from '../store.js';
import { markSeriesRead, rateBookQuick } from '../actions.js';
import { followDefault } from '../lib/follow.js';
import { isFinished } from '../lib/stats.js';
import { todayIso } from '../lib/dates.js';
import { releaseInfo } from '../components.js';
import { formatPosition } from '../ui.js';
import { listJoin } from './rate.js';

const LABELS = { 1: 'Awful', 2: 'Bad', 3: 'Poor', 4: 'Disappointing', 5: 'Okay', 6: 'Decent', 7: 'Good', 8: 'Great', 9: 'Superb', 10: 'All-time favourite' };
const FORMATS = [['print', 'Print'], ['ebook', 'Ebook'], ['audio', 'Audio']];

const isRead = (b) => {
    const lib = store.get('books', b.key);
    return lib?.status === 'read' || (lib?.reads || []).some(isFinished);
};

export function openSeriesReadSheet(series, books) {
    const today = todayIso();
    const candidates = books.filter((b) => {
        const r = releaseInfo(store.get('books', b.key) || b, today);
        return (!r.date || r.date <= today) && !isRead(b);
    });
    const thisYear = Number(today.slice(0, 4));
    const state = {
        step: 'pick',
        selected: new Set(candidates.map((b) => b.key)),
        rating: null,
        when: 'unknown',
        year: thisYear - 1,
        formats: new Set([store.settings.defaultFormat || 'print']),
        followSeries: null,
        followAuthor: null,
        marked: [],
    };
    const alreadySeries = [...store.series.values()].some((s) => s.followed && (s.id ? s.id === series.id : s.name === series.name));
    const alreadyAuthor = series.author && [...store.authors.values()].some((a) => a.followed && a.name === series.author.name);
    // you read the whole series: follow it unless you rated it 5 or lower
    const followByDefault = () => (state.rating == null ? true : followDefault(state.rating));

    const pickStep = () => {
        const chosen = candidates.filter((b) => state.selected.has(b.key));
        const fs = state.followSeries ?? followByDefault();
        const fa = state.followAuthor ?? followByDefault();
        const formats = FORMATS.filter(([id]) => state.formats.has(id)).map(([, l]) => l.toLowerCase());
        const years = Array.from({ length: 60 }, (_, i) => thisYear - i);
        return html`
        <div class="stack-sm"><span class="eyebrow">Mark books as read</span><h2 class="title-md">${series.name}</h2>
            <span class="small muted">Books you’ve already marked as read aren’t listed.</span></div>
        ${candidates.length ? html`
        <section class="stack-sm">
            <div class="row wrap" style="gap:8px">
                <button type="button" class="chip" data-all>All released (${candidates.length})</button>
                <label class="chip" style="gap:4px">Up to book<select class="select" style="min-height:0;padding:0;border:0;background:transparent;width:auto;font-weight:700" data-upto>
                    <option value="">–</option>${candidates.filter((b) => b.series?.position != null).map((b) => html`<option value="${b.series.position}">${formatPosition(b.series.position)}</option>`)}</select></label>
                <button type="button" class="chip" data-none>None</button>
            </div>
            <div class="list" role="group" aria-label="Books to mark as read">${candidates.map((b) => html`<label class="check" style="padding:0 14px;gap:10px">
                <input type="checkbox" data-book="${b.key}" ${raw(state.selected.has(b.key) ? 'checked' : '')}>
                <span class="small strong muted" style="width:52px">Book ${b.series?.position != null ? formatPosition(b.series.position) : '–'}</span>
                ${cover(store.get('books', b.key) || b, { size: 'xs', label: false })}<span class="grow">${b.title}</span></label>`)}</div>
        </section>

        <fieldset class="stack-sm" style="border:0;padding:0;margin:0">
            <legend class="eyebrow" style="margin-bottom:8px">One rating for all, out of 10 · optional</legend>
            <span class="small strong ${state.rating ? 'accent' : 'muted'}" role="status">${state.rating ? `${state.rating} out of 10 · ${LABELS[state.rating]} · you can change single books next` : 'Leave unrated to rate each book on the next step'}</span>
            <div class="rating-grid">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<button type="button" data-rate="${n}" aria-pressed="${String(state.rating === n)}" aria-label="${n} out of 10, ${LABELS[n]}">${n}</button>`)}</div>
            ${state.rating ? html`<button type="button" class="btn-link" data-unrate>Leave unrated instead</button>` : ''}
        </fieldset>

        <section class="stack-sm">
            <span class="eyebrow">When did you read them?</span>
            <div class="segmented" role="radiogroup" aria-label="When">
                <button type="button" role="radio" aria-checked="${String(state.when === 'unknown')}" data-when="unknown">I don’t remember</button>
                <button type="button" role="radio" aria-checked="${String(state.when === 'year')}" data-when="year">In a year</button>
            </div>
            ${state.when === 'year' ? html`<label class="field">Year<select class="select" data-year>${years.map((y) => html`<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}</option>`)}</select></label>
                <span class="small muted">They count towards ${state.year}’s stats${state.year === thisYear ? ' and this year’s goal' : ''}.</span>`
            : html`<span class="small muted">They’ll be on your Read shelf and in all-time stats, but not in a particular year.</span>`}
        </section>

        <section class="stack-sm">
            <div class="row-between"><span class="eyebrow">How you read them</span><span class="small muted">${formats.length > 1 ? `Hybrid: ${listJoin(formats)}` : formats[0]}</span></div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px" role="group" aria-label="Formats">
                ${FORMATS.map(([id, label]) => html`<button type="button" class="chip" style="justify-content:center;min-height:46px;border-radius:14px" aria-pressed="${String(state.formats.has(id))}" data-format="${id}">${state.formats.has(id) ? '✓ ' : ''}${label}</button>`)}
            </div>
        </section>

        <div class="list" style="background:var(--surface-2)">
            <label class="check" style="padding:0 14px"><input type="checkbox" data-follow="series" ${raw(fs || alreadySeries ? 'checked' : '')} ${raw(alreadySeries ? 'disabled' : '')}>${alreadySeries ? `Already following ${series.name}` : `Follow ${series.name} for new books`}</label>
            ${series.author ? html`<label class="check" style="padding:0 14px"><input type="checkbox" data-follow="author" ${raw(fa || alreadyAuthor ? 'checked' : '')} ${raw(alreadyAuthor ? 'disabled' : '')}>${alreadyAuthor ? `Already following ${series.author.name}` : `Follow ${series.author.name}`}</label>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <button type="button" class="btn btn-lg" data-cancel>Cancel</button>
            <button type="button" class="btn btn-primary btn-lg" data-save ${raw(chosen.length ? '' : 'disabled')}>${chosen.length ? `Mark ${chosen.length === 1 ? '1 book' : `${chosen.length} books`} as read` : 'Pick a book'}</button>
        </div>`
        : html`<p class="muted">Every released book in this series is already marked as read.</p><button type="button" class="btn btn-lg" data-cancel>Close</button>`}`;
    };

    const adjustStep = () => html`
        <div class="stack-sm"><span class="eyebrow sage">Marked as read</span><h2 class="title-md">Adjust ratings</h2>
            <span class="small muted">Tap a number to change a single book. Each tap saves straight away.</span></div>
        <div class="list">${state.marked.map((b) => {
            const lib = store.get('books', b.key);
            return html`<div class="stack-sm" style="padding:12px 14px;gap:8px">
                <span class="strong">Book ${b.series?.position != null ? formatPosition(b.series.position) : '–'} · ${b.title}</span>
                <div class="rating-grid" style="grid-template-columns:repeat(10,minmax(0,1fr));gap:4px" role="group" aria-label="Rate ${b.title} out of 10">
                    ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<button type="button" style="height:40px;font-size:15px;border-radius:10px" aria-pressed="${String(lib?.rating === n)}" data-adjust="${b.key}" data-n="${n}">${n}</button>`)}
                </div></div>`;
        })}</div>
        <button type="button" class="btn btn-primary btn-lg" data-cancel>Done</button>`;

    openSheet({
        label: `Mark ${series.name} books as read`,
        tall: true,
        content: pickStep(),
        mount(el, close) {
            const rerender = () => {
                const top = el.scrollTop;
                el.innerHTML = (state.step === 'adjust' ? adjustStep() : pickStep()).toString();
                el.scrollTop = top;
            };
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (t.dataset.book) { t.checked ? state.selected.add(t.dataset.book) : state.selected.delete(t.dataset.book); rerender(); }
                else if ('upto' in t.dataset && t.value) {
                    const max = Number(t.value);
                    state.selected = new Set(candidates.filter((b) => (b.series?.position ?? Infinity) <= max).map((b) => b.key));
                    rerender();
                } else if ('year' in t.dataset) { state.year = Number(t.value); rerender(); }
                else if (t.dataset.follow === 'series') { state.followSeries = t.checked; }
                else if (t.dataset.follow === 'author') { state.followAuthor = t.checked; }
            });
            el.addEventListener('click', async (e) => {
                const t = e.target.closest('button');
                if (!t) return;
                const d = t.dataset;
                if ('all' in d) { state.selected = new Set(candidates.map((b) => b.key)); rerender(); }
                else if ('none' in d) { state.selected = new Set(); rerender(); }
                else if (d.rate) { state.rating = Number(d.rate); rerender(); }
                else if ('unrate' in d) { state.rating = null; rerender(); }
                else if (d.when) { state.when = d.when; rerender(); }
                else if (d.format) {
                    if (state.formats.has(d.format) && state.formats.size === 1) return;
                    state.formats.has(d.format) ? state.formats.delete(d.format) : state.formats.add(d.format);
                    rerender();
                } else if (d.adjust) {
                    const b = state.marked.find((x) => x.key === d.adjust);
                    if (b) { await rateBookQuick(b, Number(d.n)); rerender(); }
                } else if ('cancel' in d) close();
                else if ('save' in d) {
                    const chosen = candidates.filter((b) => state.selected.has(b.key));
                    if (!chosen.length) return;
                    await markSeriesRead(series, chosen.map((b) => ({ ...b, series: { id: series.id, name: series.name, ...(b.series || {}) }, authors: b.authors?.length ? b.authors : series.author ? [series.author] : [] })), {
                        rating: state.rating,
                        year: state.when === 'year' ? state.year : null,
                        formats: [...state.formats],
                        followSeries: !alreadySeries && (state.followSeries ?? followByDefault()),
                        followAuthor: !alreadyAuthor && (state.followAuthor ?? followByDefault()),
                    });
                    state.marked = chosen;
                    state.step = 'adjust';
                    rerender();
                    el.scrollTop = 0;
                }
            });
        },
    });
}
