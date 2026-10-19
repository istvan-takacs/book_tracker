// Finish-and-rate sheet. Short by default (rating, finish date, follow,
// Save); format, feel, moods and review sit behind "Add details", which
// remembers whether it was left open.

import { html, openSheet, raw } from '../ui.js';
import { store } from '../store.js';
import { finishBook, saveMoodsVocabulary } from '../actions.js';
import { followDefault, followHint } from '../lib/follow.js';
import { todayIso, formatDay } from '../lib/dates.js';
import { normalize } from '../lib/text.js';

const LABELS = { 1: 'Awful', 2: 'Bad', 3: 'Poor', 4: 'Disappointing', 5: 'Okay', 6: 'Decent', 7: 'Good', 8: 'Great', 9: 'Superb', 10: 'All-time favourite' };
const FORMATS = [['print', 'Print'], ['ebook', 'Ebook'], ['audio', 'Audio']];
const SCALES = [
    ['pace', 'Pace', [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']]],
    ['tone', 'Tone', [['light', 'Light'], ['balanced', 'Balanced'], ['dark', 'Dark']]],
    ['drivenBy', 'Driven by', [['plot', 'Plot'], ['both', 'Both'], ['characters', 'Characters']]],
];
export const listJoin = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const STARTER_MOODS = ['adventurous', 'dark', 'emotional', 'funny', 'hopeful', 'mysterious', 'reflective', 'tense', 'cosy', 'epic', 'twisty', 'slow-burn'];

function moodsYouUse() {
    const counts = new Map();
    for (const b of store.books.values()) for (const r of b.reads || []) for (const m of r.moods || []) counts.set(m, (counts.get(m) || 0) + 1);
    const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    return [...new Set([...used, ...(store.settings.customMoods || []), ...STARTER_MOODS])];
}

export function openRateSheet(book, { readIndex = null } = {}) {
    const lib = store.get('books', book.key) || book;
    const reads = lib.reads || [];
    const editing = readIndex != null ? reads[readIndex] : reads.findLast?.((r) => !r.finishedAt && !r.abandonedAt) || null;
    const state = {
        rating: editing?.rating ?? null,
        startedAt: editing?.startedAt || '',
        finishedAt: editing?.finishedAt || todayIso(),
        formats: new Set(editing?.formats?.length ? editing.formats : [store.settings.defaultFormat || 'print']),
        scales: { ...(editing?.scales || {}) },
        moods: new Set(editing?.moods || []),
        extraMoods: [],
        review: lib.review || '',
        followAuthor: null,
        followSeries: null,
        details: !!store.settings.finishSheetExpanded,
        dates: readIndex != null,
        adding: false,
    };
    const author = (lib.authors || [])[0];
    const series = lib.series?.name ? lib.series : null;
    const alreadyAuthor = author && [...store.authors.values()].some((a) => a.followed && normalize(a.name) === normalize(author.name));
    const alreadySeries = series && [...store.series.values()].some((s) => s.followed && normalize(s.name) === normalize(series.name));
    const suggested = (lib.communityMoods || []).map((m) => m.toLowerCase()).slice(0, 6);

    const render = () => {
        const fa = state.followAuthor ?? followDefault(state.rating);
        const fs = state.followSeries ?? followDefault(state.rating);
        const chosen = FORMATS.filter(([id]) => state.formats.has(id)).map(([, l]) => l.toLowerCase());
        const mine = moodsYouUse().filter((m) => !suggested.includes(m)).slice(0, 8);
        const chip = (m) => html`<button type="button" class="chip" aria-pressed="${String(state.moods.has(m))}" data-mood="${m}">${state.moods.has(m) ? '✓ ' : ''}${m}</button>`;
        return html`
        <div style="text-align:center" class="stack-sm">
            <span class="eyebrow sage">${readIndex != null ? 'Edit this read' : 'You finished'}</span>
            <h2 class="title-md">${lib.title}</h2>
            <span class="small muted">${[author?.name, series ? `${series.name}${series.position ? `, book ${series.position}` : ''}` : null].filter(Boolean).join(' · ')}</span>
        </div>
        <fieldset class="stack-sm" style="border:0;padding:0;margin:0">
            <legend class="eyebrow" style="margin-bottom:8px">Your rating, out of 10</legend>
            <span class="accent strong" role="status">${state.rating ? `${state.rating} out of 10 · ${LABELS[state.rating]}` : 'Tap a number'}</span>
            <div class="rating-grid">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<button type="button" data-rate="${n}" aria-pressed="${String(state.rating === n)}" aria-label="${n} out of 10, ${LABELS[n]}">${n}</button>`)}</div>
        </fieldset>
        ${state.dates ? html`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label class="field">Started reading<input class="input" type="date" data-field="startedAt" value="${state.startedAt}"></label>
            <label class="field">Finished reading<input class="input" type="date" data-field="finishedAt" value="${state.finishedAt}" max="${todayIso()}"></label></div>`
        : html`<div class="row-between card card-tight" style="background:var(--surface-2)"><span><span class="muted">Finished</span> <strong>${state.finishedAt === todayIso() ? `today, ${formatDay(state.finishedAt, undefined, { weekday: false })}` : formatDay(state.finishedAt)}</strong></span><button type="button" class="btn-link" data-show-dates>Change</button></div>`}
        <button type="button" class="btn btn-block" style="border-style:dashed;justify-content:space-between;min-height:56px" aria-expanded="${String(state.details)}" data-toggle-details>
            <span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px"><span>${state.details ? 'Hide details' : 'Add details · optional'}</span><span class="small muted" style="font-weight:500">${state.details ? 'Stays open next time' : 'Format, how it felt, moods, review'}</span></span>
            <span aria-hidden="true" class="muted" style="font-size:20px">${state.details ? '−' : '+'}</span></button>
        ${state.details ? html`
        <div class="stack-sm">
            <div class="row-between"><span class="eyebrow">How you read it</span><span class="small strong ${chosen.length > 1 ? 'sage' : 'muted'}" role="status">${chosen.length > 1 ? `Hybrid: ${listJoin(chosen)}` : chosen[0] || ''}</span></div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px" role="group" aria-label="Formats used">
                ${FORMATS.map(([id, label]) => html`<button type="button" class="chip" style="justify-content:center;min-height:50px;border-radius:14px" aria-pressed="${String(state.formats.has(id))}" data-format="${id}">${state.formats.has(id) ? '✓ ' : ''}${label}</button>`)}
            </div>
            <span class="small muted">Select every format you used. More than one marks the read as hybrid.</span>
        </div>
        <section class="card stack-sm" style="background:var(--surface-2)">
            <span class="eyebrow">How did it feel? · optional</span>
            <span class="small muted">These power your stats and “More like this”.</span>
            ${SCALES.map(([id, name, opts]) => html`<div class="stack-sm" style="gap:6px"><span class="strong small">${name}</span>
                <div class="segmented" role="radiogroup" aria-label="${name}" style="background:var(--surface)">${opts.map(([v, l]) => html`<button type="button" role="radio" data-scale="${id}" data-value="${v}" aria-checked="${String(state.scales[id] === v)}">${l}</button>`)}</div></div>`)}
        </section>
        <section class="stack-sm">
            <div class="row-between"><span class="eyebrow">Moods · optional</span><span class="small muted">${state.moods.size ? `${state.moods.size} selected` : 'None selected'}</span></div>
            ${suggested.length ? html`<span class="small muted strong">Suggested for this book, from Hardcover readers</span><div class="chips">${suggested.map(chip)}</div>` : ''}
            <span class="small muted strong">Moods you use most</span>
            <div class="chips">${[...mine, ...state.extraMoods].map(chip)}
                ${state.adding ? '' : html`<button type="button" class="chip chip-dashed" data-add-mood>+ New mood</button>`}</div>
            ${state.adding ? html`<div class="row"><label class="grow"><span class="visually-hidden">New mood name</span><input class="input" data-new-mood placeholder="e.g. comfort read" maxlength="30"></label><button type="button" class="btn btn-primary" data-commit-mood>Add</button><button type="button" class="btn" data-cancel-mood>Cancel</button></div>` : ''}
            <span class="small muted">New moods are saved and offered again on future books.</span>
        </section>
        <label class="field"><span class="eyebrow">Review · optional</span><textarea class="textarea" data-field="review" placeholder="What stayed with you?">${state.review}</textarea></label>` : ''}
        ${author || series ? html`<div class="stack-sm" style="gap:6px"><div class="list" style="background:var(--surface-2)">
            ${author ? html`<label class="check" style="padding:0 14px"><input type="checkbox" data-follow="author" ${raw(fa || alreadyAuthor ? 'checked' : '')} ${raw(alreadyAuthor ? 'disabled' : '')}>${alreadyAuthor ? `Already following ${author.name}` : `Follow ${author.name} for new releases`}</label>` : ''}
            ${series ? html`<label class="check" style="padding:0 14px"><input type="checkbox" data-follow="series" ${raw(fs || alreadySeries ? 'checked' : '')} ${raw(alreadySeries ? 'disabled' : '')}>${alreadySeries ? `Already following ${series.name}` : `Follow ${/^the\s/i.test(series.name) ? series.name : `the ${series.name} series`}`}</label>` : ''}
        </div><span class="small muted" role="status">${state.rating ? followHint(state.rating, state.followAuthor !== null || state.followSeries !== null) : 'Pick a rating to see follow suggestions.'}</span></div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <button type="button" class="btn btn-lg" data-cancel>Cancel</button>
            <button type="button" class="btn btn-primary btn-lg" data-save ${raw(state.rating ? '' : 'disabled')}>Save</button>
        </div>`;
    };

    openSheet({
        label: `Finish and rate ${lib.title}`,
        tall: true,
        content: render(),
        mount(el, close) {
            const rerender = () => {
                const top = el.scrollTop;
                el.innerHTML = render().toString();
                el.scrollTop = top;
                el.querySelector('[data-new-mood]')?.focus();
            };
            el.addEventListener('input', (e) => {
                const f = e.target.dataset.field;
                if (f) state[f] = e.target.value;
            });
            el.addEventListener('change', (e) => {
                const which = e.target.dataset.follow;
                if (which === 'author') state.followAuthor = e.target.checked;
                if (which === 'series') state.followSeries = e.target.checked;
                if (which) rerender();
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.matches('[data-new-mood]')) { e.preventDefault(); el.querySelector('[data-commit-mood]').click(); }
            });
            el.addEventListener('click', async (e) => {
                const t = e.target.closest('button');
                if (!t) return;
                const d = t.dataset;
                if (d.rate) { state.rating = Number(d.rate); rerender(); }
                else if ('showDates' in d) { state.dates = true; rerender(); }
                else if ('toggleDetails' in d) { state.details = !state.details; store.saveSettings({ finishSheetExpanded: state.details }); rerender(); }
                else if (d.format) {
                    if (state.formats.has(d.format) && state.formats.size === 1) return; // at least one format
                    state.formats.has(d.format) ? state.formats.delete(d.format) : state.formats.add(d.format);
                    rerender();
                } else if (d.scale) { state.scales[d.scale] = state.scales[d.scale] === d.value ? undefined : d.value; rerender(); }
                else if (d.mood) { state.moods.has(d.mood) ? state.moods.delete(d.mood) : state.moods.add(d.mood); rerender(); }
                else if ('addMood' in d) { state.adding = true; rerender(); }
                else if ('cancelMood' in d) { state.adding = false; rerender(); }
                else if ('commitMood' in d) {
                    const v = el.querySelector('[data-new-mood]').value.trim().toLowerCase();
                    if (!v) return;
                    state.adding = false;
                    state.moods.add(v);
                    if (!moodsYouUse().includes(v)) state.extraMoods.push(v);
                    saveMoodsVocabulary(v);
                    rerender();
                } else if ('cancel' in d) close();
                else if ('save' in d && state.rating) {
                    close();
                    await finishBook(lib, {
                        rating: state.rating, startedAt: state.startedAt || null, finishedAt: state.finishedAt || todayIso(),
                        formats: [...state.formats], scales: Object.fromEntries(Object.entries(state.scales).filter(([, v]) => v)),
                        moods: [...state.moods], review: state.review.trim() || null,
                        followAuthor: alreadyAuthor ? false : state.followAuthor, followSeries: alreadySeries ? false : state.followSeries, readIndex,
                    });
                }
            });
        },
    });
}
