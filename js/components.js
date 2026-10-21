// Reusable pieces of markup used by several views.

import { html, raw, icon, cover, authorLinks, seriesLabel, plural, fmtNumber } from './ui.js';
import { effectiveRelease, formatRelease, daysBetween, relativeDays, todayIso } from './lib/dates.js';
import { googleCalendarUrl, releaseEvent } from './lib/calendar.js';
import { store } from './store.js';
import { isFinished } from './lib/stats.js';
import { appUrl } from '../config.js';

export const SHELVES = [['want', 'TBR'], ['reading', 'Reading'], ['read', 'Read'], ['dnf', 'DNF']];

export function bookHref(book) {
    return `#/book/${encodeURIComponent(book.key)}`;
}

/** The library copy of a book, if it is in the library. */
export function inLibrary(book) {
    return book?.key ? store.get('books', book.key) : null;
}

/** Community rating out of 5 from Hardcover, whichever field it arrived in. */
export function communityRating(book) {
    return book?.communityRating ?? (book?.status ? null : book?.rating) ?? null;
}

export function releaseInfo(book, today = todayIso()) {
    const rel = effectiveRelease(book);
    const label = formatRelease(rel, today);
    let when = '';
    if (rel.date && rel.precision === 'day') when = relativeDays(daysBetween(today, rel.date));
    return { ...rel, label, when, exact: rel.precision === 'day' && !!rel.date };
}

export function calendarLink(book, { compact = false } = {}) {
    const rel = releaseInfo(book);
    if (!rel.exact) return '';
    const url = googleCalendarUrl(releaseEvent(book, rel.date, { appUrl }));
    return compact
        ? html`<a class="btn btn-soft btn-icon" href="${url}" target="_blank" rel="noopener" aria-label="Add ${book.title} to Google Calendar">${icon('calendarAdd', 20)}</a>`
        : html`<a class="btn btn-soft btn-sm" href="${url}" target="_blank" rel="noopener">${icon('calendarAdd', 18)}Add to calendar</a>`;
}

/** Your relationship to a book, in words. */
export function libraryStatus(book) {
    const lib = inLibrary(book) || (book.status ? book : null);
    if (!lib) return null;
    const reads = (lib.reads || []).filter((r) => isFinished(r));
    if (lib.status === 'read') return lib.rating != null ? `You rated it ${lib.rating} out of 10${reads.length > 1 ? ` · read ${plural(reads.length, 'time')}` : ''}` : 'Read';
    if (lib.status === 'reading') return `Reading · ${Math.round((lib.progress?.fraction || 0) * 100)}% done`;
    if (lib.status === 'want') return 'On your TBR';
    if (lib.status === 'dnf') return 'DNF';
    if (lib.status === 'upcoming') return 'Coming soon · in your Upcoming list';
    return null;
}

export function bookRow(book, { actions = '', showRelease = false, badges = '', size = 'md' } = {}) {
    const status = libraryStatus(book);
    const rel = showRelease ? releaseInfo(book) : null;
    return html`<article class="book-row">
        <a href="${bookHref(book)}" aria-label="Open ${book.title}">${cover(book, { size, label: false })}</a>
        <div class="meta">
            ${badges ? html`<div class="row wrap" style="gap:6px">${badges}</div>` : ''}
            <a class="line-title clamp-2" href="${bookHref(book)}">${book.title}</a>
            ${book.authors?.length ? html`<span class="small muted">${authorLinks(book.authors)}</span>` : ''}
            ${book.series?.name ? html`<span class="small muted">${seriesLabel(book.series)}</span>` : ''}
            ${rel ? html`<span class="small"><span class="strong">${rel.label}</span>${rel.when ? html` · <span class="accent strong">${rel.when}</span>` : ''}${rel.manual ? html` · <span class="badge badge-accent">SET BY YOU</span>` : ''}</span>` : ''}
            ${status ? html`<span class="small sage strong">${status}</span>` : ''}
            ${actions ? html`<div class="actions">${actions}</div>` : ''}
        </div>
    </article>`;
}

export function goalRing(progress, size = 68) {
    const r = 28, c = 2 * Math.PI * r;
    const pct = progress ? Math.min(1, progress.read / progress.goal) : 0;
    return raw(`<svg class="goal-ring" width="${size}" height="${size}" viewBox="0 0 68 68" role="img" aria-label="${progress ? `${progress.read} of ${progress.goal} books read` : 'No goal set'}">
        <circle cx="34" cy="34" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>
        <circle cx="34" cy="34" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 34 34)"/>
        <text x="34" y="39" text-anchor="middle" font-family="Fraunces, serif" font-size="15" font-weight="600" fill="var(--text)">${Math.round(pct * 100)}%</text></svg>`);
}

export function communityLine(book) {
    const r = communityRating(book);
    if (r == null || !book.ratingsCount) return '';
    return html`<span class="small muted">${Number(r).toFixed(1)} out of 5 from ${fmtNumber(book.ratingsCount)} Hardcover readers</span>`;
}

/** Shelf buttons for a book (TBR / Reading / Read / DNF). */
export function shelfPicker(current) {
    return html`<div class="segmented" role="radiogroup" aria-label="Shelf" style="grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-flow:row">
        ${SHELVES.map(([id, label]) => html`<button type="button" role="radio" aria-checked="${String(current === id)}" data-action="shelf" data-shelf="${id}">${label}</button>`)}
    </div>`;
}

export function sectionHead(title, link = null) {
    return html`<div class="row-between"><h2 class="eyebrow">${title}</h2>${link ? html`<a class="btn-link" href="${link.href}">${link.label}</a>` : ''}</div>`;
}

export function hardcoverBanner(status) {
    if (!status || ['ok', 'unknown', 'unconfigured'].includes(status.hardcover)) return '';
    const msg = status.hardcover === 'offline' ? 'You are offline. Showing your library; new searches resume when you are back online.'
        : status.hardcover === 'limited' ? 'Book data limit reached for the moment. Showing your library and Google Books results.'
            : 'Book data is temporarily unavailable. Showing your library and Google Books results.';
    return html`<div class="banner banner-warn" role="status"><span class="dot" aria-hidden="true"></span><span>${msg} <a class="accent strong" href="#/settings">Details</a></span></div>`;
}
