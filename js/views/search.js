import { html, icon, cover, authorLinks, seriesLabel, esc, raw, plural, morph } from '../ui.js';
import { store } from '../store.js';
import { searchAll, sourceStatus } from '../api.js';
import { rankResults } from '../lib/search.js';
import { normalize, tokens } from '../lib/text.js';
import { bookHref, libraryStatus, releaseInfo, hardcoverBanner } from '../components.js';
import { setShelf } from '../actions.js';
import { openAddBookSheet } from '../sheets/releaseDate.js';

const RECENT_KEY = 'bt-recent-searches';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const remember = (q) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recent().filter((x) => x !== q)].slice(0, 8))); } catch { /* blocked */ } };

const state = { q: '', filter: 'all', results: null, loading: false, correction: null, original: null, gen: 0, remote: null };
const metaByKey = new Map();

function libraryCandidates() {
    const books = [...store.books.values()].map((b) => ({ ...b, inLibrary: true, readersCount: b.readersCount || 0 }));
    const authorMap = new Map();
    for (const b of books) for (const a of b.authors || []) if (a.name) authorMap.set(normalize(a.name), { hardcoverId: a.id || null, name: a.name, booksCount: 0 });
    for (const a of store.authors.values()) authorMap.set(normalize(a.name), { hardcoverId: a.hardcoverId, name: a.name, booksCount: 0 });
    const series = [...store.series.values()].map((s) => ({ id: s.id, name: s.name, authorName: s.authorNames?.[0] || null, readersCount: 0, followedKey: s.key }));
    return { books, authors: [...authorMap.values()], series };
}

function context() {
    return {
        libraryKeys: new Set(store.books.keys()),
        followedAuthors: new Set([...store.authors.values()].filter((a) => a.followed).map((a) => normalize(a.name))),
        followedSeries: new Set([...store.series.values()].filter((s) => s.followed).map((s) => s.id).filter(Boolean)),
    };
}

function combine(local, remote) {
    const books = [...local.books, ...(remote?.books || [])];
    const authors = [...local.authors];
    for (const a of remote?.authors || []) {
        const i = authors.findIndex((x) => normalize(x.name) === normalize(a.name));
        if (i === -1) authors.push(a); else authors[i] = { ...a, ...authors[i], hardcoverId: authors[i].hardcoverId || a.hardcoverId, booksCount: a.booksCount };
    }
    const series = [...local.series];
    for (const s of remote?.series || []) {
        const i = series.findIndex((x) => normalize(x.name) === normalize(s.name));
        if (i === -1) series.push(s); else series[i] = { ...s, ...series[i], id: series[i].id || s.id, booksCount: s.booksCount };
    }
    return { books, authors, series };
}

function highlight(text, q) {
    const words = tokens(q).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length || !text) return esc(text);
    // match on the raw text, then escape each piece, so entities are never split
    const re = new RegExp(`(^|[^\\p{L}])((?:${words.join('|')})[\\p{L}]*)`, 'giu');
    let out = '', last = 0;
    for (const m of String(text).matchAll(re)) {
        const start = m.index + m[1].length;
        out += esc(text.slice(last, start)) + `<mark>${esc(m[2])}</mark>`;
        last = start + m[2].length;
    }
    return out + esc(text.slice(last));
}

function resultsHtml() {
    const { results, q, filter } = state;
    if (!q.trim()) {
        const r = recent();
        return html`${r.length ? html`<section class="stack-sm"><div class="row-between"><h2 class="eyebrow">Recent searches</h2><button type="button" class="btn-link" data-action="clearRecent">Clear</button></div>
            <div class="list">${r.map((x) => html`<button type="button" class="list-row list-row-btn" data-action="recent" data-q="${x}">${icon('search', 18)}<span class="grow">${x}</span></button>`)}</div></section>` : ''}
            <div class="card stack-sm"><span class="strong">Search by title, author or series.</span><span class="small muted">Typos are fine: “brandon sandersen” finds Brandon Sanderson. Add a number for a book in a series, like “mistborn 2”.</span>
            <div class="row wrap"><a class="btn btn-sm" href="#/scan">${icon('scan', 18)}Scan a barcode</a><button type="button" class="btn btn-sm" data-action="manual">Add a book manually</button></div></div>`;
    }
    if (!results) return html`<div class="skeleton"></div><div class="skeleton"></div>`;
    const show = (t) => filter === 'all' || filter === t;
    const authors = results.authors.slice(0, filter === 'authors' ? 12 : 3);
    const series = results.series.slice(0, filter === 'series' ? 12 : 3);
    const books = results.books.slice(0, filter === 'books' ? 40 : 15);
    const nothing = !authors.length && !series.length && !books.length;
    const groups = {
        authors: show('authors') && authors.length ? html`<section class="stack-sm"><h2 class="eyebrow">${authors.length > 1 ? 'Authors' : 'Author'}</h2><div class="list">${authors.map((a) => {
            const followed = [...store.authors.values()].some((x) => x.followed && normalize(x.name) === normalize(a.name));
            const href = a.hardcoverId ? `#/author/hc_${a.hardcoverId}` : `#/author/name/${encodeURIComponent(a.name)}`;
            return html`<a class="list-row" href="${href}"><span style="flex:0 0 46px;height:46px;border-radius:23px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font:600 16px var(--display);overflow:hidden">${a.imageUrl ? html`<img src="${a.imageUrl}" alt="" width="46" height="46" style="object-fit:cover" referrerpolicy="no-referrer">` : a.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                <span class="grow stack-sm" style="gap:2px"><span class="line-title">${raw(highlight(a.name, q))}</span><span class="small muted">${[a.booksCount ? plural(a.booksCount, 'book') : null, a.seriesNames?.length ? a.seriesNames.slice(0, 2).join(', ') : null].filter(Boolean).join(' · ')}</span></span>
                ${followed ? html`<span class="badge badge-new">FOLLOWING</span>` : ''}</a>`;
        })}</div></section>` : '',
        series: show('series') && series.length ? html`<section class="stack-sm"><h2 class="eyebrow">Series</h2><div class="list">${series.map((s) => {
            const followed = [...store.series.values()].some((x) => x.followed && normalize(x.name) === normalize(s.name));
            const href = s.id ? `#/series/hc_${s.id}` : `#/series/name/${encodeURIComponent(s.name)}`;
            return html`<a class="list-row" href="${href}">
                <span class="grow stack-sm" style="gap:2px"><span class="line-title">${raw(highlight(s.name, q))}</span><span class="small muted" style="font-weight:500">${[s.authorName, s.booksCount ? plural(s.booksCount, 'book') : null].filter(Boolean).join(' · ')}</span></span>
                ${followed ? html`<span class="badge badge-new">FOLLOWING</span>` : html`<span class="small accent">See series</span>`}</a>`;
        })}</div></section>` : '',
        books: show('books') && books.length ? html`<section class="stack-sm"><h2 class="eyebrow">Books</h2><div class="list">${books.map((b) => {
            metaByKey.set(b.key, b);
            const status = libraryStatus(b);
            const rel = releaseInfo(b);
            const future = rel.date && rel.date > new Date().toISOString().slice(0, 10);
            return html`<div class="list-row"><a href="${bookHref(b)}" aria-label="Open ${b.title}">${cover(b, { size: 'sm', label: false })}</a>
                <span class="grow stack-sm" style="gap:2px;min-width:0"><a class="line-title" href="${bookHref(b)}">${raw(highlight(b.title, q))}</a>
                    <span class="small muted">${authorLinks(b.authors)}${b.series?.name ? ` · ${seriesLabel(b.series)}` : ''}</span>
                    ${status ? html`<span class="small sage strong">${status}</span>` : future ? html`<span class="small accent strong">Out ${rel.label}</span>` : ''}
                    ${!b.verified && !b.inLibrary ? html`<span class="small muted">From ${b.openLibraryKey ? 'Open Library' : 'Google Books'}</span>` : ''}</span>
                ${status ? '' : html`<button type="button" class="btn btn-outline btn-sm" data-action="tbr" data-key="${b.key}">Add to TBR</button>`}</div>`;
        })}</div></section>` : '',
    };
    const order = results.lead === 'authors' ? ['authors', 'series', 'books'] : results.lead === 'series' ? ['series', 'books', 'authors'] : ['books', 'authors', 'series'];
    const offlineSearch = q.trim().length >= 3 && !state.loading && state.remote && state.remote.hardcover !== 'ok' && state.remote.google !== 'ok' && state.remote.openlibrary !== 'ok';
    return html`
        ${hardcoverBanner(sourceStatus)}
        ${offlineSearch ? html`<div class="banner banner-warn" role="status"><span class="dot" aria-hidden="true"></span><span>${navigator.onLine === false ? 'You’re offline, so only your library was searched.'
            : state.remote.google === 'quota' ? 'Online search is busy right now (Google Books’ shared daily limit is used up), so only your library was searched. Adding your own Google Books key in config.js fixes this.'
            : 'Online search didn’t respond, so only your library was searched. Try again in a moment.'}</span></div>` : ''}
        ${state.correction ? html`<p class="banner banner-plain">Showing results for <strong style="color:var(--text)">${state.correction}</strong>&nbsp;·&nbsp;<button type="button" class="btn-link" style="min-height:0" data-action="exact">search “${state.original}” instead</button></p>` : ''}
        ${order.map((k) => groups[k])}
        ${state.loading ? html`<p class="small muted" role="status">Looking further…</p>` : ''}
        ${nothing && !state.loading ? html`<div class="empty"><p class="muted">No matches for “${q}”.${q.length < 3 ? ' Type at least 3 letters to search beyond your library.' : ''}</p></div>` : ''}
        ${!state.loading && q.length >= 3 ? html`<p class="small muted" style="text-align:center">Can’t find it? <button type="button" class="btn-link" data-action="manual">Add it manually</button></p>` : ''}`;
}

let timer = null;
let paintResults = () => {};
const REMOTE_DELAY = 450; // ms after typing stops before asking Hardcover

/** Instant results from your library while typing; no network. */
function runLocal(q) {
    state.gen++;
    state.q = q;
    state.correction = null;
    state.results = q.trim() ? rankResults(q, libraryCandidates(), context()) : null;
    state.loading = q.trim().length >= 3;
    paintResults();
}

async function run(q, { exact = false } = {}) {
    const gen = ++state.gen;
    state.q = q;
    state.correction = null;
    state.original = null;
    const local = libraryCandidates();
    const ctx = context();
    if (!q.trim()) { state.results = null; paintResults(); return; }
    state.results = rankResults(q, local, ctx);
    if (q.trim().length < 3) { state.loading = false; paintResults(); return; }
    state.loading = true;
    paintResults();
    const onPartial = (remote) => { if (gen === state.gen) { state.results = rankResults(q, combine(local, remote), ctx); paintResults(); } };
    const include = { authors: state.filter === 'authors', series: state.filter === 'series' };
    const remote = await searchAll(q.trim(), { onPartial, include }).catch(() => null);
    if (gen !== state.gen) return;
    state.remote = remote;
    let ranked = rankResults(q, combine(local, remote), ctx);
    const top = Math.max(ranked.books[0]?._score ?? 0, ranked.authors[0]?._score ?? 0, ranked.series[0]?._score ?? 0);
    if (!exact && ranked.correction && top < 0.75) {
        const fixed = await searchAll(ranked.correction, { include }).catch(() => null);
        if (gen !== state.gen) return;
        const fixedRanked = rankResults(ranked.correction, combine(local, fixed), ctx);
        const fixedTop = Math.max(fixedRanked.books[0]?._score ?? 0, fixedRanked.authors[0]?._score ?? 0, fixedRanked.series[0]?._score ?? 0);
        if (fixedTop > top) { state.correction = ranked.correction; state.original = q; ranked = fixedRanked; }
    }
    state.results = ranked;
    state.loading = false;
    remember(q.trim());
    paintResults();
}

export default {
    tab: 'search',
    manual: true,
    render() {
        return html`<div class="stack search-view">
            <h1 class="title">Search</h1>
            <div class="chips scroll-x" role="radiogroup" aria-label="Result type">${[['all', 'All'], ['books', 'Books'], ['authors', 'Authors'], ['series', 'Series']].map(([v, l]) => html`<button type="button" class="chip chip-solid" role="radio" aria-checked="${String(state.filter === v)}" data-action="filter" data-v="${v}">${l}</button>`)}</div>
            <div class="stack" data-results aria-live="polite"></div>
        </div>
        <form class="searchbar" role="search" data-searchform>
            <label>${icon('search', 20)}<span class="visually-hidden">Search authors, titles or series</span>
                <input type="search" name="q" value="${state.q}" placeholder="Authors, titles, series…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" data-input>
                ${state.q ? html`<button type="button" class="btn btn-icon" style="border:0" aria-label="Clear search" data-action="clear">${icon('close', 18)}</button>` : ''}
                <a class="btn btn-soft btn-icon" href="#/scan" aria-label="Scan a barcode instead" style="border-radius:12px">${icon('scan', 22)}</a>
            </label></form>`;
    },
    mount(root, { query }) {
        const resultsEl = root.querySelector('[data-results]');
        const input = root.querySelector('[data-input]');
        paintResults = () => { if (resultsEl.isConnected) morph(resultsEl, resultsHtml()); };
        const initial = query.get('q');
        if (initial && initial !== state.q) { input.value = initial; run(initial); } else { state.results ? paintResults() : run(state.q); }
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const v = input.value;
            const clear = root.querySelector('[data-action="clear"]');
            if (!v && clear) clear.remove();
            runLocal(v);
            if (v.trim().length >= 3) timer = setTimeout(() => run(v), REMOTE_DELAY);
        });
        // While typing, dock the field at the top (see style.css "Search while typing").
        let leaveTimer = null;
        input.addEventListener('focus', () => {
            clearTimeout(leaveTimer);
            document.body.classList.add('search-typing');
            window.scrollTo(0, 0);
        });
        input.addEventListener('blur', () => {
            // wait a moment so a tapped result doesn't move under your finger
            leaveTimer = setTimeout(() => { if (document.activeElement !== input) document.body.classList.remove('search-typing'); }, 400);
        });
        root.querySelector('[data-searchform]').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); run(input.value); input.blur(); });
        if (!state.q && matchMedia('(min-width: 900px)').matches) input.focus();
        const unsub = store.subscribe(() => paintResults());
        return () => { unsub(); paintResults = () => {}; clearTimeout(leaveTimer); document.body.classList.remove('search-typing'); };
    },
    handlers: {
        filter(el) {
            const was = state.filter;
            state.filter = el.dataset.v;
            document.querySelectorAll('[data-action="filter"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state.filter)));
            // Authors/Series ask Hardcover for dedicated results (one request); other chips just re-filter
            if (['authors', 'series'].includes(state.filter) && state.filter !== was && state.q.trim().length >= 3) run(state.q);
            else paintResults();
        },
        clear() { const i = document.querySelector('[data-input]'); i.value = ''; run(''); i.focus(); },
        recent(el) { const i = document.querySelector('[data-input]'); i.value = el.dataset.q; run(el.dataset.q); },
        clearRecent() { try { localStorage.removeItem(RECENT_KEY); } catch { /* blocked */ } paintResults(); },
        exact() { run(state.original, { exact: true }); },
        tbr(el) { const m = metaByKey.get(el.dataset.key); if (m) setShelf(m, 'want'); },
        manual() { openAddBookSheet({ title: state.q.trim() }); },
    },
};

