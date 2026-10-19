import { html, icon, cover, authorLinks, seriesLabel, plural } from '../ui.js';
import { store } from '../store.js';
import { computeStats, goalProgress } from '../lib/stats.js';
import { todayIso, effectiveRelease } from '../lib/dates.js';
import { goalRing, releaseInfo, bookHref, sectionHead, hardcoverBanner } from '../components.js';
import { sourceStatus } from '../api.js';
import { openProgressSheet } from '../sheets/progress.js';
import { setShelf } from '../actions.js';

function greeting(d = new Date()) {
    const h = d.getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function dateLine(d = new Date()) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function initials() {
    const n = store.settings.displayName || '';
    return n ? n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() : 'Me';
}

/** The next unread book in each followed series (released, or with no date yet). */
function upNext(today) {
    const out = [];
    for (const s of store.series.values()) {
        if (!s.followed || !s.books?.length) continue;
        const next = s.books
            .filter((b) => (b.position || 0) > (s.maxPositionRead || 0) && Number.isInteger(b.position))
            .filter((b) => !b.releaseDate || b.releaseDate <= today)
            .sort((a, b) => a.position - b.position)[0];
        if (!next) continue;
        const lib = store.get('books', next.key);
        if (lib && ['read', 'reading', 'want', 'dnf'].includes(lib.status)) continue;
        const prevRating = [...store.books.values()].find((b) => b.series?.name === s.name && b.series?.position === next.position - 1)?.rating;
        out.push({ series: s, book: { ...next, series: { id: s.id, name: s.name, position: next.position }, authors: (s.authorNames || []).map((name) => ({ name })) }, prevRating });
    }
    return out.slice(0, 4);
}

export default {
    tab: 'home',
    render() {
        const today = todayIso();
        const year = today.slice(0, 4);
        const books = [...store.books.values()];
        const libraryCount = books.filter((b) => b.status !== 'upcoming').length;
        const stats = computeStats(books, { year });
        const goal = store.settings.goals?.[year];
        const g = goalProgress(stats.books, goal, today);
        const reading = books.filter((b) => b.status === 'reading').sort((a, b) => (b.progress?.updatedAt || '').localeCompare(a.progress?.updatedAt || ''));
        const soon = books
            .filter((b) => ['upcoming', 'want'].includes(b.status))
            .map((b) => ({ b, rel: effectiveRelease(b) }))
            .filter(({ rel }) => rel.date && rel.date >= today)
            .sort((x, y) => x.rel.date.localeCompare(y.rel.date))
            .slice(0, 3);
        const finished = books
            .flatMap((b) => (b.reads || []).filter((r) => r.finishedAt).map((r) => ({ b, r })))
            .sort((x, y) => y.r.finishedAt.localeCompare(x.r.finishedAt))
            .slice(0, 8);
        const next = upNext(today);

        const header = html`<header class="row-between" style="align-items:flex-start">
            <div class="stack-sm" style="gap:4px"><span class="eyebrow">${dateLine()}</span><h1 class="title">${greeting()}</h1></div>
            <div class="row" style="gap:8px">
                <a class="btn btn-primary btn-sm" href="#/scan" style="border-radius:22px">${icon('scan', 20)}Scan</a>
                <a class="btn btn-icon" href="#/settings" aria-label="Profile and settings" style="background:var(--surface)">${initials()}</a>
            </div></header>`;

        if (!libraryCount && !soon.length) {
            return html`<div class="stack">${header}
                <div class="card empty">
                    <h2 class="title-md">Welcome to your library</h2>
                    <p class="muted">Add the books you’ve read and the ones on your TBR. Rating a book also starts following its author, so their new releases show up in Upcoming.</p>
                    <a class="btn btn-primary btn-lg" href="#/settings/import">Import from Goodreads</a>
                    <a class="btn btn-lg" href="#/scan">Scan a barcode</a>
                    <a class="btn btn-lg" href="#/search">Search for a book</a>
                </div></div>`;
        }

        return html`<div class="stack">
            ${header}
            ${hardcoverBanner(sourceStatus)}
            <section class="card row" aria-label="Reading goal" style="gap:16px">
                ${goalRing(g)}
                ${g ? html`<div class="grow stack-sm" style="gap:4px">
                        <span class="title-sm">${g.read} of ${plural(g.goal, 'book')}</span>
                        <span class="small strong ${g.aheadBy >= 0 ? 'sage' : 'warn'}">${g.done ? 'Goal reached. Well done!' : g.aheadBy > 0 ? `On track: ${plural(g.aheadBy, 'book')} ahead of schedule` : g.aheadBy === 0 ? 'Exactly on schedule' : `${plural(-g.aheadBy, 'book')} behind schedule`}</span>
                        <span class="small muted">${year} reading goal</span></div>`
                : html`<div class="grow stack-sm" style="gap:4px"><span class="title-sm">${plural(stats.books, 'book')} read in ${year}</span><a class="btn-link" href="#/settings/goal">Set a reading goal</a></div>`}
            </section>

            ${reading.length ? html`<section class="stack-sm">${sectionHead('Currently reading')}
                <div class="carousel">${reading.map((b) => {
                    const pct = Math.round((b.progress?.fraction || 0) * 100);
                    const page = b.pageCount ? Math.round((b.progress?.fraction || 0) * b.pageCount) : null;
                    return html`<article class="reading-card">
                        <a href="${bookHref(b)}" aria-label="Open ${b.title}">${cover(b, { size: 'md', label: false })}</a>
                        <div class="grow stack-sm" style="gap:6px">
                            <a class="title-sm clamp-2" href="${bookHref(b)}">${b.title}</a>
                            <span class="small muted">${authorLinks(b.authors)}</span>
                            <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><span style="width:${pct}%"></span></div>
                            <span class="small muted">${page != null ? `Page ${page} of ${b.pageCount} · ` : ''}${pct}%</span>
                            <button type="button" class="btn btn-outline btn-sm" data-action="progress" data-key="${b.key}" style="margin-top:auto">Update progress</button>
                        </div></article>`;
                })}</div></section>` : ''}

            ${soon.length ? html`<section class="stack-sm">${sectionHead('Coming soon', { href: '#/upcoming', label: 'See all' })}
                <div class="list">${soon.map(({ b }) => {
                    const r = releaseInfo(b, today);
                    return html`<a class="list-row" href="${bookHref(b)}">${cover(b, { size: 'sm', label: false })}
                        <span class="grow stack-sm" style="gap:2px"><span class="line-title">${b.title}</span><span class="small muted">${[seriesLabel(b.series), b.authors?.[0]?.name].filter(Boolean).join(' · ')}</span></span>
                        <span class="badge badge-accent" style="white-space:nowrap">${r.when || (r.precision === 'year' ? `Expected ${r.date.slice(0, 4)}` : r.label.replace('Expected ', ''))}</span></a>`;
                })}</div></section>` : ''}

            ${next.length ? html`<section class="stack-sm">${sectionHead('Up next in your series')}
                ${next.map(({ book, prevRating }) => html`<div class="book-row">
                    <a href="${bookHref(book)}">${cover(book, { size: 'sm', label: false })}</a>
                    <div class="meta"><a class="line-title" href="${bookHref(book)}">${book.title}</a>
                        <span class="small muted">${seriesLabel(book.series)}</span>
                        ${prevRating ? html`<span class="small sage strong">You gave book ${book.series.position - 1} a ${prevRating} out of 10</span>` : ''}</div>
                    <button type="button" class="btn btn-primary btn-sm" data-action="tbr" data-key="${book.key}" style="align-self:center">Add to TBR</button></div>`)}
            </section>` : ''}

            ${finished.length ? html`<section class="stack-sm">${sectionHead('Recently finished', { href: '#/library?shelf=read', label: 'All read' })}
                <span class="small muted">The number on each cover is your rating out of 10.</span>
                <div class="grid-covers" style="grid-template-columns:repeat(4,minmax(0,1fr))">${finished.slice(0, 8).map(({ b, r }) => html`<a class="cover-wrap" href="${bookHref(b)}" aria-label="${b.title}${r.rating ? `, rated ${r.rating} out of 10` : ''}">${cover(b, { size: 'fill', label: false })}${r.rating ? html`<span class="rating-badge" aria-hidden="true">${r.rating}</span>` : ''}</a>`)}</div>
            </section>` : ''}
        </div>`;
    },
    handlers: {
        progress(el) { const b = store.get('books', el.dataset.key); if (b) openProgressSheet(b); },
        tbr(el) {
            for (const s of store.series.values()) {
                const b = s.books?.find((x) => x.key === el.dataset.key);
                if (b) return setShelf({ ...b, series: { id: s.id, name: s.name, position: b.position }, authors: (s.authorNames || []).map((name) => ({ name })) }, 'want');
            }
        },
    },
};
