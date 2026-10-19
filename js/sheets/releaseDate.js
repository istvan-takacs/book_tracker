// Set a release date yourself, and add books no source knows about yet.

import { html, openSheet, cover, raw } from '../ui.js';
import { setReleaseDate, addManualBook, clearReleaseOverride } from '../actions.js';
import { formatDay, daysBetween, todayIso, relativeDays, formatRelease } from '../lib/dates.js';
import { googleCalendarUrl, releaseEvent } from '../lib/calendar.js';
import { appUrl } from '../../config.js';

export function openReleaseDateSheet(book) {
    const existing = book.releaseDateOverride || {};
    const state = { date: existing.date || '', sourceUrl: existing.sourceUrl || '', note: existing.note || '', addToCalendar: true };
    const preview = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(state.date)) return { pretty: 'Pick a date', when: 'No date chosen yet' };
        const days = daysBetween(todayIso(), state.date);
        return { pretty: formatDay(state.date), when: days >= 0 ? relativeDays(days) : 'already out' };
    };
    const content = html`
        <h2 class="title-md">Set release date</h2>
        <div class="row">${cover(book, { size: 'sm', label: false })}<div class="grow stack-sm" style="gap:3px">
            <span class="strong">${book.title}</span>
            <span class="small muted">${book.authors?.[0]?.name || ''}</span>
            <span class="small muted">Hardcover says: <strong>${formatRelease({ date: book.releaseDate, precision: book.datePrecision || 'none' })}</strong></span></div></div>
        <label class="field"><span class="eyebrow">Release date</span><input class="input" type="date" data-f="date" value="${state.date}" required></label>
        <label class="field"><span class="eyebrow">Where you found it · optional</span><input class="input" type="url" data-f="sourceUrl" value="${state.sourceUrl}" placeholder="Paste a link, e.g. the author’s newsletter"></label>
        <label class="field"><span class="eyebrow">Note · optional</span><input class="input" type="text" data-f="note" value="${state.note}" maxlength="120" placeholder="e.g. UK hardback date"></label>
        <div class="card stack-sm" style="background:var(--surface-2)">
            <span class="eyebrow">Preview</span>
            <div class="row wrap"><span class="strong" data-pretty></span><span class="badge badge-accent">SET BY YOU</span></div>
            <span class="small muted"><span data-when></span> · will appear in Upcoming and in your calendar feed</span>
        </div>
        <label class="check"><input type="checkbox" data-cal checked>Open Google Calendar to add it after saving</label>
        <p class="small muted">If Hardcover later announces a different date, you’ll be asked before yours is replaced. If it confirms the same date, the “Set by you” badge goes away.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><button type="button" class="btn btn-lg" data-cancel>Cancel</button><button type="button" class="btn btn-primary btn-lg" data-save>Save date</button></div>
        ${existing.date ? html`<button type="button" class="btn-link" data-clear>Remove your date and use Hardcover’s</button>` : ''}`;

    openSheet({
        label: `Set release date for ${book.title}`,
        content,
        mount(el, close) {
            const paint = () => {
                const p = preview();
                el.querySelector('[data-pretty]').textContent = p.pretty;
                el.querySelector('[data-when]').textContent = p.when;
                el.querySelector('[data-save]').disabled = !state.date;
            };
            paint();
            el.addEventListener('input', (e) => { const f = e.target.dataset.f; if (f) { state[f] = e.target.value; paint(); } });
            el.addEventListener('click', async (e) => {
                const t = e.target.closest('button');
                if (!t) return;
                if ('cancel' in t.dataset) close();
                if ('clear' in t.dataset) { await clearReleaseOverride(book.key); close(); }
                if ('save' in t.dataset && state.date) {
                    const wantsCal = el.querySelector('[data-cal]').checked;
                    await setReleaseDate(book, { date: state.date, sourceUrl: state.sourceUrl.trim() || null, note: state.note.trim() || null });
                    close();
                    if (wantsCal) window.open(googleCalendarUrl(releaseEvent({ ...book, releaseDateOverride: { date: state.date } }, state.date, { appUrl })), '_blank', 'noopener');
                }
            });
        },
    });
}

export function openAddBookSheet(prefill = {}) {
    const state = { title: prefill.title || '', author: prefill.author || '', seriesName: '', position: '', date: '', status: prefill.status || 'want' };
    const content = html`
        <h2 class="title-md">Add a book manually</h2>
        <p class="small muted">For books that Hardcover, Google Books and Open Library don’t list yet. It’s marked “Added by you” and links up automatically if a source finds it later.</p>
        ${prefill.isbn ? html`<span class="small muted">ISBN ${prefill.isbn}</span>` : ''}
        <label class="field"><span class="eyebrow">Title</span><input class="input" data-f="title" value="${state.title}" required></label>
        <label class="field"><span class="eyebrow">Author</span><input class="input" data-f="author" value="${state.author}"></label>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
            <label class="field"><span class="eyebrow">Series · optional</span><input class="input" data-f="seriesName"></label>
            <label class="field"><span class="eyebrow">Book number</span><input class="input" type="number" inputmode="decimal" min="0" step="0.5" data-f="position"></label>
        </div>
        <label class="field"><span class="eyebrow">Release date · optional</span><input class="input" type="date" data-f="date"></label>
        <div class="segmented" role="radiogroup" aria-label="Shelf">${[['want', 'TBR'], ['upcoming', 'Upcoming'], ['read', 'Read']].map(([v, l]) => html`<button type="button" role="radio" data-status="${v}" aria-checked="${String(state.status === v)}">${l}</button>`)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><button type="button" class="btn btn-lg" data-cancel>Cancel</button><button type="button" class="btn btn-primary btn-lg" data-save ${raw(state.title ? '' : 'disabled')}>Add book</button></div>`;
    openSheet({
        label: 'Add a book manually',
        content,
        mount(el, close) {
            el.addEventListener('input', (e) => {
                const f = e.target.dataset.f;
                if (f) state[f] = e.target.value;
                el.querySelector('[data-save]').disabled = !state.title.trim();
            });
            el.addEventListener('click', async (e) => {
                const t = e.target.closest('button');
                if (!t) return;
                if (t.dataset.status) { state.status = t.dataset.status; el.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-checked', String(b === t))); }
                if ('cancel' in t.dataset) close();
                if ('save' in t.dataset && state.title.trim()) {
                    const key = await addManualBook({ ...state, title: state.title.trim(), author: state.author.trim() });
                    close();
                    location.hash = `#/book/${key}`;
                }
            });
        },
    });
}
