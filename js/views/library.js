import { html, icon, cover, authorLink, authorLinks, seriesLabel, plural } from '../ui.js';
import { store } from '../store.js';
import { bookHref, SHELVES, releaseInfo } from '../components.js';
import { unfollowAuthor, followAuthorAction, setSeriesFollow, authorKey } from '../actions.js';
import { normalize } from '../lib/text.js';
import { isFinished, readYear } from '../lib/stats.js';
import { checkReleases, lastChecked } from '../releases.js';
import { relativeDays, daysBetween, todayIso } from '../lib/dates.js';

const MOOD_LABELS = { slow: 'Slow-paced', medium: 'Medium pace', fast: 'Fast-paced', light: 'Light tone', balanced: 'Balanced tone', dark: 'Dark', plot: 'Plot-driven', both: 'Plot and character', characters: 'Character-driven' };
const SORTS = { rating: 'Your rating', finished: 'Date finished', added: 'Date added', title: 'Title', author: 'Author' };
const pref = (k, d) => { try { return localStorage.getItem(`bt-lib-${k}`) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`bt-lib-${k}`, v); } catch { /* blocked */ } };

const lastFinished = (b) => (b.reads || []).filter((r) => r.finishedAt).map((r) => r.finishedAt).sort().at(-1) || '';

function shelfView(query) {
    const shelf = query.get('shelf') || pref('shelf', 'read');
    const sort = query.get('sort') || pref('sort', shelf === 'read' ? 'finished' : 'added');
    const year = query.get('year') || 'all';
    const mood = query.get('mood') || 'any';
    const layout = pref('layout', 'grid');
    const all = [...store.books.values()].filter((b) => b.status !== 'upcoming' && b.status !== 'dismissed');
    const counts = Object.fromEntries(SHELVES.map(([id]) => [id, all.filter((b) => b.status === id).length]));
    const tags = [...new Set(all.flatMap((b) => b.tags || []))].sort();
    const years = [...new Set(all.flatMap((b) => (b.reads || []).map((r) => readYear(r)).filter(Boolean).map(String)))].sort().reverse();
    const moods = [...new Set(all.flatMap((b) => (b.reads || []).flatMap((r) => [...(r.moods || []), ...Object.values(r.scales || {})])))].sort();

    let list = all.filter((b) => b.status === shelf || (shelf.startsWith('tag:') && (b.tags || []).includes(shelf.slice(4))));
    if (year !== 'all') list = list.filter((b) => (b.reads || []).some((r) => String(readYear(r)) === year));
    if (mood !== 'any') list = list.filter((b) => (b.reads || []).some((r) => (r.moods || []).includes(mood) || Object.values(r.scales || {}).includes(mood)));
    const by = {
        rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || lastFinished(b).localeCompare(lastFinished(a)),
        finished: (a, b) => lastFinished(b).localeCompare(lastFinished(a)),
        added: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
        title: (a, b) => normalize(a.title).localeCompare(normalize(b.title)),
        author: (a, b) => normalize(a.authors?.[0]?.name?.split(' ').at(-1)).localeCompare(normalize(b.authors?.[0]?.name?.split(' ').at(-1))),
    };
    list.sort(by[sort] || by.added);
    const q = (patch) => {
        const p = new URLSearchParams({ shelf, sort, year, mood, ...patch });
        return `#/library?${p}`;
    };
    const label = { want: 'TBR', reading: 'Reading', read: 'Read', dnf: 'DNF' };
    const empty = {
        want: 'Nothing on your TBR yet. Add books from Search, a scan, or a book page.',
        reading: 'You are not reading anything right now. Start a book from your TBR.',
        read: 'No finished books yet. Mark a book as read to rate it out of 10.',
        dnf: 'No DNF books. Books you stop reading go here.',
    }[shelf] || 'No books here yet.';

    return html`
        <div class="chips scroll-x" role="radiogroup" aria-label="Shelf">
            ${SHELVES.map(([id]) => html`<a class="chip" role="radio" aria-checked="${String(shelf === id)}" href="${q({ shelf: id, sort: id === 'read' ? 'finished' : 'added' })}" data-action="pref" data-k="shelf" data-v="${id}">${label[id]} <span class="muted">${counts[id]}</span></a>`)}
            ${tags.map((t) => html`<a class="chip" role="radio" aria-checked="${String(shelf === `tag:${t}`)}" href="${q({ shelf: `tag:${t}` })}">#${t}</a>`)}
        </div>
        <div class="row wrap" style="gap:8px">
            <label class="chip" style="gap:4px">Sort<select class="select" style="min-height:0;padding:0;border:0;background:transparent;width:auto;font-weight:700" data-action="nav" data-on="change">${Object.entries(SORTS).map(([v, l]) => html`<option value="${q({ sort: v })}" ${v === sort ? 'selected' : ''}>${l}</option>`)}</select></label>
            ${years.length ? html`<label class="chip" style="gap:4px">Year<select class="select" style="min-height:0;padding:0;border:0;background:transparent;width:auto;font-weight:700" data-action="nav" data-on="change"><option value="${q({ year: 'all' })}">All</option>${years.map((y) => html`<option value="${q({ year: y })}" ${y === year ? 'selected' : ''}>${y}</option>`)}</select></label>` : ''}
            ${moods.length ? html`<label class="chip" style="gap:4px">Mood<select class="select" style="min-height:0;padding:0;border:0;background:transparent;width:auto;font-weight:700" data-action="nav" data-on="change"><option value="${q({ mood: 'any' })}">Any</option>${moods.map((m) => html`<option value="${q({ mood: m })}" ${m === mood ? 'selected' : ''}>${MOOD_LABELS[m] || m}</option>`)}</select></label>` : ''}
            <span class="grow"></span>
            <div class="segmented" role="radiogroup" aria-label="Layout" style="grid-auto-columns:44px">
                <button type="button" role="radio" aria-checked="${String(layout === 'grid')}" aria-label="Grid" data-action="layout" data-v="grid">${icon('grid', 18)}</button>
                <button type="button" role="radio" aria-checked="${String(layout === 'list')}" aria-label="List" data-action="layout" data-v="list">${icon('list', 18)}</button>
            </div>
        </div>
        ${list.length ? html`<p class="small muted">${shelf === 'read' ? 'The number on each cover is your rating out of 10. ' : ''}Tap a cover for the book, or a name for the author.</p>` : ''}
        ${!all.length ? html`<div class="empty">
                <h2 class="title-md">Your library is empty</h2>
                <p class="muted">Add the books you’ve read and the ones on your TBR. Rating a book also starts following its author for new releases.</p>
                <a class="btn btn-primary btn-lg" href="#/settings/import">Import from Goodreads</a>
                <a class="btn btn-lg" href="#/scan">Scan a barcode</a>
                <a class="btn btn-lg" href="#/search">Search for a book</a></div>`
        : !list.length ? html`<div class="empty"><p class="muted">${empty}</p><a class="btn" href="#/search">Find a book</a></div>`
        : layout === 'grid' ? html`<div class="grid-covers">${list.map((b) => html`<div class="stack-sm" style="gap:4px;min-width:0">
                <a class="cover-wrap" href="${bookHref(b)}" aria-label="Open ${b.title}${b.rating ? `, rated ${b.rating} out of 10` : ''}">${cover(b, { size: 'fill', label: false })}${b.status === 'read' && b.rating ? html`<span class="rating-badge" aria-hidden="true">${b.rating}</span>` : ''}</a>
                ${b.authors?.[0] ? authorLink(b.authors[0], 'author-link small ellipsis') : ''}
                <span class="small muted ellipsis">${subline(b)}</span></div>`)}</div>`
        : html`<div class="list">${list.map((b) => html`<div class="list-row">
                <a href="${bookHref(b)}" aria-label="Open ${b.title}">${cover(b, { size: 'sm', label: false })}</a>
                <span class="grow stack-sm" style="gap:0"><a class="line-title" href="${bookHref(b)}">${b.title}</a>
                    <span class="small muted">${authorLinks(b.authors)} · ${subline(b)}</span></span>
                ${b.rating && b.status === 'read' ? html`<span class="strong accent" aria-label="Your rating ${b.rating} out of 10">${b.rating}/10</span>` : ''}</div>`)}</div>`}`;
}

function subline(b) {
    if (b.status === 'reading') return `${Math.round((b.progress?.fraction || 0) * 100)}% done`;
    if (b.status === 'dnf') { const r = (b.reads || []).at(-1); return r?.stoppedAt != null ? `stopped at ${Math.round(r.stoppedAt * 100)}%` : 'DNF'; }
    if (b.status === 'read') {
        const f = lastFinished(b);
        const times = (b.reads || []).filter((r) => isFinished(r)).length;
        const y = (b.reads || []).map((r) => r.finishedYear).filter(Boolean).sort().at(-1);
        return `${f ? new Date(f + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : y ? `Read in ${y}` : 'Read'}${times > 1 ? ` · read ${times} times` : ''}`;
    }
    return b.addedAt ? `added ${new Date(b.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : '';
}

function readStats(name) {
    const mine = [...store.books.values()].filter((b) => b.authors?.some((a) => normalize(a.name) === normalize(name)));
    const read = mine.filter((b) => b.status === 'read');
    const rated = read.map((b) => b.rating).filter((r) => r != null);
    const upcoming = mine.filter((b) => b.status === 'upcoming' && (!b.releaseDate || b.releaseDate >= todayIso()));
    return { read: read.length, average: rated.length ? Math.round((rated.reduce((s, v) => s + v, 0) / rated.length) * 10) / 10 : null, upcoming };
}

function authorsView() {
    const list = [...store.authors.values()].filter((a) => a.followed).sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
    const last = lastChecked();
    return html`${list.length ? html`<div class="list">${list.map((a) => {
        const s = readStats(a.name);
        const next = s.upcoming.sort((x, y) => (x.releaseDate || '9').localeCompare(y.releaseDate || '9'))[0];
        const nextInfo = next ? releaseInfo(next) : null;
        const href = a.hardcoverId ? `#/author/hc_${a.hardcoverId}` : `#/author/name/${encodeURIComponent(a.name)}`;
        return html`<div class="list-row">
            <a class="row grow" href="${href}">
                <span class="btn-icon" style="display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:23px;background:var(--surface-2);font:600 16px var(--display);flex:0 0 auto">${a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                <span class="grow stack-sm" style="gap:2px"><span class="line-title">${a.name}</span>
                    <span class="small muted">${plural(s.read, 'book')} read${s.average != null ? ` · your average rating ${s.average}` : ''}</span>
                    <span class="small strong ${next ? 'sage' : 'muted'}">${next ? `${next.title} · ${nextInfo.when || nextInfo.label}` : 'Nothing announced yet'}</span></span></a>
            <button type="button" class="btn btn-sm" aria-pressed="true" data-action="unfollow" data-key="${authorKey({ id: a.hardcoverId, name: a.name })}">Following</button></div>`;
    })}</div>` : html`<div class="empty"><p class="muted">You don’t follow any authors yet. Rating a book 6 or higher follows its author automatically, or follow one from their page.</p><a class="btn" href="#/search">Find an author</a></div>`}
    <div class="row-between"><span class="small muted">${last ? `Last checked for new releases ${relativeDays(daysBetween(todayIso(), todayIso(last))) === 'today' ? 'today' : relativeDays(daysBetween(todayIso(), todayIso(last)))}` : 'Not checked for new releases yet'}</span>
    <button type="button" class="btn-link" data-action="check">Check now</button></div>`;
}

function seriesView() {
    const list = [...store.series.values()].filter((s) => s.followed).sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
    if (!list.length) return html`<div class="empty"><p class="muted">You don’t follow any series yet. Finishing a book in a series with a rating of 6 or higher follows the series.</p></div>`;
    return html`<div class="stack-sm">${list.map((s) => {
        const books = (s.books || []).filter((b) => Number.isInteger(b.position));
        const total = s.total || books.length || null;
        const readPositions = new Set([...store.books.values()].filter((b) => b.status === 'read' && normalize(b.series?.name) === normalize(s.name)).map((b) => b.series.position));
        const readCount = readPositions.size;
        const next = books.find((b) => !readPositions.has(b.position) && b.position > (s.maxPositionRead || 0));
        return html`<div class="card stack-sm">
            <div class="row-between"><a class="title-sm" href="${s.id ? `#/series/hc_${s.id}` : `#/series/name/${encodeURIComponent(s.name)}`}">${s.name}</a><button type="button" class="btn btn-sm" aria-pressed="true" data-action="unfollowSeries" data-key="${s.key}">Following</button></div>
            ${s.authorNames?.length ? html`<span class="small muted">${s.authorNames.join(', ')}</span>` : ''}
            ${books.length ? html`<div class="row" style="gap:6px;overflow-x:auto">${books.slice(0, 12).map((b) => html`<a href="${bookHref(b)}" style="opacity:${readPositions.has(b.position) ? 1 : 0.45}" aria-label="Book ${b.position}: ${b.title}${readPositions.has(b.position) ? ', read' : ''}">${cover(b, { size: 'xs', label: false })}</a>`)}</div>` : ''}
            ${total ? html`<div class="progress-bar"><span style="width:${Math.min(100, Math.round((readCount / total) * 100))}%"></span></div>` : ''}
            <div class="row-between small"><span class="strong">Read ${readCount}${total ? ` of ${total}` : ''}</span>${next ? html`<span class="sage strong">Next: book ${next.position}, ${next.title}</span>` : ''}</div>
            <a class="btn btn-sm" href="${s.id ? `#/series/hc_${s.id}` : `#/series/name/${encodeURIComponent(s.name)}`}">See the series · mark books as read</a>
        </div>`;
    })}</div>`;
}

export default {
    tab: 'library',
    render({ params, query }) {
        const seg = params.segment || 'shelves';
        return html`<div class="stack">
            <h1 class="title">Library</h1>
            <nav class="segmented" aria-label="Library sections">
                <a href="#/library" ${seg === 'shelves' ? html`aria-current="page"` : ''}>Shelves</a>
                <a href="#/library/authors" ${seg === 'authors' ? html`aria-current="page"` : ''}>Authors ${[...store.authors.values()].filter((a) => a.followed).length || ''}</a>
                <a href="#/library/series" ${seg === 'series' ? html`aria-current="page"` : ''}>Series ${[...store.series.values()].filter((s) => s.followed).length || ''}</a>
            </nav>
            ${seg === 'authors' ? authorsView() : seg === 'series' ? seriesView() : shelfView(query)}
        </div>`;
    },
    handlers: {
        nav(el) { location.hash = el.value; },
        pref(el) { setPref(el.dataset.k, el.dataset.v); },
        layout(el) { setPref('layout', el.dataset.v); window.dispatchEvent(new Event('bt:rerender')); },
        unfollow(el) { const a = store.get('authors', el.dataset.key); if (a) unfollowAuthor({ id: a.hardcoverId, name: a.name }); },
        unfollowSeries(el) { const s = store.get('series', el.dataset.key); if (s) setSeriesFollow({ id: s.id, name: s.name }, false); },
        async check(el) { el.disabled = true; el.textContent = 'Checking…'; await checkReleases({ force: true }).catch(() => null); el.disabled = false; el.textContent = 'Check now'; },
        follow(el) { followAuthorAction({ id: Number(el.dataset.id) || null, name: el.dataset.name }); },
    },
};
