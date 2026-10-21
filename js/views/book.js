import { html, icon, cover, authorLinks, seriesLabel, plural, fmtNumber, raw, safeUrl } from '../ui.js';
import { store } from '../store.js';
import { bookDetails, booksByIds, seriesBooks, hardcoverAvailable } from '../api.js';
import { shelfPicker, releaseInfo, calendarLink, communityRating, bookHref } from '../components.js';
import { setShelf, removeBook, startReread, metaOf, clearReleaseOverride } from '../actions.js';
import { openProgressSheet } from '../sheets/progress.js';
import { openRateSheet, listJoin } from '../sheets/rate.js';
import { openReleaseDateSheet } from '../sheets/releaseDate.js';
import { formatDay, todayIso, daysBetween } from '../lib/dates.js';
import { formatDuration } from '../lib/progress.js';
import { isFinished } from '../lib/stats.js';

// Details fetched this session, so returning to a book is instant.
const details = new Map();
const extras = new Map();
const openPanels = new Set(['details']);
let expandedAbout = false;

const SOURCE_NAMES = { hardcover: 'Hardcover', google: 'Google Books', openlibrary: 'Open Library' };

function currentBook(key) {
    const lib = store.get('books', key);
    const d = details.get(key);
    if (lib && d) return { ...d, ...lib, coverUrl: lib.coverUrl || d.coverUrl, description: lib.description || d.description, editions: d.editions || lib.editions, communityMoods: d.communityMoods?.length ? d.communityMoods : lib.communityMoods, contentWarnings: d.contentWarnings || lib.contentWarnings, narrator: d.narrator || lib.narrator, publisher: d.publisher || lib.publisher, similarIds: d.similarIds || lib.similarIds, communityRating: d.rating ?? lib.communityRating, ratingsCount: d.ratingsCount ?? lib.ratingsCount };
    return lib || d || null;
}

const REFRESH_AFTER = 7 * 24 * 60 * 60 * 1000;

async function load(key, rerender) {
    const known = currentBook(key);
    const lib = store.get('books', key);
    // Library books keep their details in Firestore; only ask Hardcover again
    // when they are a week old (saves requests on every reopen).
    const fetchedAt = Date.parse(lib?.metaFetchedAt || '') || 0;
    const fresh = lib && lib.title && Date.now() - fetchedAt < REFRESH_AFTER;
    if (!fresh) {
        try {
            const detail = await bookDetails(key, known);
            if (detail) {
                details.set(key, detail);
                // keep the library copy's metadata current without touching your data
                const current = store.get('books', key);
                if (current) {
                    const patch = { metaFetchedAt: new Date().toISOString() };
                    for (const [k, v] of Object.entries(metaOf(detail))) {
                        if (['verified', 'sources', 'releaseDate', 'datePrecision'].includes(k)) continue;
                        const empty = current[k] == null || (Array.isArray(current[k]) && !current[k].length);
                        // community data changes over time: refresh it on each weekly fetch
                        if (empty || ['communityMoods', 'genres', 'contentWarnings', 'communityRating', 'ratingsCount', 'readersCount', 'similarIds'].includes(k)) patch[k] = v;
                    }
                    store.save('books', key, patch);
                }
            }
        } catch (e) { console.warn('[book] details', e); }
        rerender();
    }
    const b = currentBook(key);
    if (!b || !hardcoverAvailable()) return;
    const ex = extras.get(key) || {};
    if (b.series?.id && !ex.series) {
        try { const [s] = await seriesBooks([b.series.id]); ex.series = s || null; } catch { /* optional section */ }
    }
    // "More like this" is nice-to-have: background priority, so it never
    // competes with what you're doing for Hardcover requests
    if (b.similarIds?.length && !ex.similar) {
        try { ex.similar = await booksByIds(b.similarIds.slice(0, 12)); } catch { /* optional section */ }
    }
    extras.set(key, ex);
    rerender();
}

function similarReason(book, me) {
    const lib = store.get('books', book.key);
    if (lib?.status === 'read' && lib.rating) return `You rated it ${lib.rating}`;
    if (lib?.status === 'want') return 'On your TBR';
    if (me.authors?.some((a) => book.authors?.some((x) => x.name === a.name))) return `Also by ${book.authors[0].name}`;
    const shared = (book.genres || []).filter((g) => (me.genres || []).includes(g));
    if (shared.length) return shared.slice(0, 2).join(', ');
    return 'Readers of this also liked it';
}

function rankSimilar(list, me) {
    const myMoods = new Set([...store.books.values()].filter((b) => (b.rating || 0) >= 8).flatMap((b) => (b.reads || []).flatMap((r) => r.moods || [])));
    return list
        .filter((b) => b.key !== me.key && !b.compilation)
        .map((b, i) => {
            const lib = store.get('books', b.key);
            let s = 30 - i; // Hardcover's own order
            s += (b.communityMoods || []).filter((m) => myMoods.has(m.toLowerCase())).length * 4;
            if (lib?.status === 'read') s -= 10; // you already know these
            return { b, s };
        })
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((x) => x.b);
}

export default {
    tab: null,
    immersive: true,
    render({ params }) {
        const key = decodeURIComponent(params.key);
        const b = currentBook(key);
        if (!b) {
            return html`<div class="page-body"><a class="back-link" href="#" data-action="back">${icon('back')}Back</a><div class="skeleton" style="height:220px"></div><p class="muted" role="status">Loading book…</p></div>`;
        }
        const lib = store.get('books', key);
        const status = lib?.status || null;
        const rel = releaseInfo(b);
        const today = todayIso();
        const isFuture = rel.date && rel.date > today;
        const reads = lib?.reads || [];
        const finished = reads.map((r, i) => ({ r, i })).filter(({ r }) => isFinished(r) || r.abandonedAt);
        const current = status === 'reading' ? reads.at(-1) : null;
        const cr = communityRating(b);
        const ex = extras.get(key) || {};
        const seriesList = ex.series?.books?.filter((x) => Number.isInteger(x.series.position)) || [];
        const moods = (b.communityMoods || []).slice(0, 6);
        const totalInSeries = b.series?.total || ex.series?.total;
        const sources = Object.entries(b.sources || {}).filter(([, s]) => s !== 'hardcover');
        const q = encodeURIComponent(`${b.title} ${b.authors?.[0]?.name || ''}`.trim());

        const panels = [
            { id: 'details', title: 'Book details', hint: 'Publisher, pages, audiobook length, ISBN', rows: [
                ['Publisher', b.publisher], ['First published', b.firstPublished && formatDay(b.firstPublished, '0000', { weekday: false })], ['Pages', b.pageCount],
                ['Audiobook', b.audioSeconds && formatDuration(b.audioSeconds)], ['Narrated by', b.narrator], ['ISBN-13', b.isbn13],
            ].filter(([, v]) => v) },
            { id: 'editions', title: 'Editions and formats', hint: b.editions?.length ? plural(b.editions.length, 'edition') : 'Not available', rows: (b.editions || []).map((e) => [e.format || 'Edition', [e.releaseDate?.slice(0, 4), e.pages && `${e.pages} pages`, e.audioSeconds && formatDuration(e.audioSeconds), e.publisher].filter(Boolean).join(' · ')]) },
            { id: 'warnings', title: 'Content warnings', hint: 'Hidden until you open it', rows: (b.contentWarnings || []).length ? [['Readers flagged', b.contentWarnings.join(', ')]] : [['', 'None listed']] },
            { id: 'get', title: 'Where to get it', hint: 'Library, shops and audiobook', links: [
                ['Borrow', 'Search Libby', `https://libbyapp.com/search/query-${q}`],
                ['Buy print', 'Bookshop.org', `https://bookshop.org/search?keywords=${q}`],
                ['Buy ebook', 'Amazon Kindle', `https://www.amazon.com/s?k=${q}&i=digital-text`],
                ['Audiobook', 'Audible', `https://www.audible.com/search?keywords=${q}`],
            ] },
        ];

        return html`
        <div class="hero" style="--hero:${raw(heroColour(b))}">
            <div class="row-between"><a class="hero-btn" href="#" data-action="back">${icon('back')}Back</a>
                ${lib ? html`<button type="button" class="hero-btn" style="padding:0 14px" data-action="remove">Remove</button>` : ''}</div>
            <div class="row" style="align-items:flex-end;gap:18px">
                ${cover(b, { size: 'lg' })}
                <div class="stack-sm grow" style="gap:4px">
                    ${b.series?.name ? html`<span class="small strong" style="opacity:.9">${seriesLabel(b.series)}${totalInSeries ? ` of ${totalInSeries}` : ''}</span>` : ''}
                    <h1 class="title" style="font-size:28px">${b.title}</h1>
                    ${b.subtitle ? html`<span class="small">${b.subtitle}</span>` : ''}
                    <span>${authorLinks(b.authors)}</span>
                    <span class="small" style="opacity:.9">${[rel.date && !isFuture ? `Published ${rel.date.slice(0, 4)}` : null, b.pageCount && `${b.pageCount} pages`].filter(Boolean).join(' · ')}</span>
                    ${!b.verified ? html`<span class="badge" style="background:rgba(0,0,0,.25);align-self:flex-start">${b.manual ? 'ADDED BY YOU' : 'NOT YET CONFIRMED'}</span>` : ''}
                </div>
            </div>
            ${cr != null && b.ratingsCount ? html`<div class="hero-rating"><span style="font:700 18px var(--display)">${Number(cr).toFixed(1)}</span><span>out of 5 from ${fmtNumber(b.ratingsCount)} Hardcover readers</span></div>` : ''}
        </div>
        <div class="page-body">
            ${lib?.pendingDate ? html`<div class="banner banner-warn" role="status"><span class="dot"></span><span class="grow">Hardcover now says this comes out <strong>${formatDay(lib.pendingDate.date)}</strong>. You set ${formatDay(lib.releaseDateOverride?.date || lib.pendingDate.date)}.
                <span class="row" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-action="acceptDate">Use Hardcover’s date</button><button type="button" class="btn btn-sm" data-action="keepDate">Keep mine</button></span></span></div>` : ''}

            ${isFuture || status === 'upcoming' || (!lib && !rel.date) ? html`<section class="card stack-sm">
                <span class="eyebrow">Release date</span>
                <div class="row-between"><span><span class="title-sm">${rel.label}</span>${rel.when ? html`<br><span class="accent strong small">${rel.when}</span>` : ''}</span>${calendarLink(b)}</div>
                ${rel.manual ? html`<span class="small muted">Set by you${lib.releaseDateOverride?.note ? ` · ${lib.releaseDateOverride.note}` : ''}${lib.releaseDateOverride?.sourceUrl ? html` · <a class="accent" href="${safeUrl(lib.releaseDateOverride.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</span>` : ''}
                <button type="button" class="btn-link" data-action="setDate">${rel.manual ? 'Change your date' : rel.exact ? 'Know a different date? Set it yourself' : 'Found a date online? Set it yourself'}</button>
            </section>` : ''}

            <section class="stack-sm"><span class="eyebrow">On your shelf</span>${shelfPicker(status === 'upcoming' ? null : status)}
                ${!lib ? html`<span class="small muted">Not in your library yet. Pick a shelf to add it.</span>` : ''}</section>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${status === 'reading' ? html`<button type="button" class="btn btn-primary" data-action="progress">Update progress</button><button type="button" class="btn" data-action="finish">I finished it</button>`
                : status === 'read' ? html`<button type="button" class="btn btn-primary" data-action="reread">Start a re-read</button><button type="button" class="btn" data-action="editRating">Edit your rating</button>`
                : html`<button type="button" class="btn btn-primary" data-action="start" ${raw(isFuture ? 'disabled' : '')}>${isFuture ? 'Not out yet' : 'Start reading'}</button><button type="button" class="btn" data-action="finish" ${raw(isFuture ? 'disabled' : '')}>I’ve read it</button>`}
            </div>
            ${current ? html`<div class="stack-sm"><div class="progress-bar"><span style="width:${Math.round((lib.progress?.fraction || 0) * 100)}%"></span></div><span class="small muted">${Math.round((lib.progress?.fraction || 0) * 100)}% done · started ${current.startedAt ? formatDay(current.startedAt, today, { weekday: false }) : 'recently'}</span></div>` : ''}

            ${b.description ? html`<section class="stack-sm"><h2 class="eyebrow">About this book</h2>
                <p class="prose" style="white-space:pre-line">${expandedAbout || b.description.length < 420 ? b.description : b.description.slice(0, 380).replace(/\s+\S*$/, '') + '…'}</p>
                ${b.description.length >= 420 ? html`<button type="button" class="btn-link" data-action="about">${expandedAbout ? 'Show less' : 'Read the full description'}</button>` : ''}
                ${b.genres?.length ? html`<div class="chips">${b.genres.slice(0, 5).map((g) => html`<span class="tag tag-plain">${g}</span>`)}</div>` : ''}</section>` : ''}

            ${moods.length ? html`<section class="card stack-sm"><h2 class="eyebrow">What readers say it feels like</h2>
                <div class="chips">${moods.map((m) => html`<span class="tag">${m.toLowerCase()}</span>`)}</div>
                <span class="small muted">The most-tagged moods from Hardcover readers, most common first.</span></section>` : ''}

            ${finished.length || lib?.review ? html`<section class="stack-sm"><h2 class="eyebrow">Your reading history</h2>
                <div class="list">${finished.reverse().map(({ r, i }) => html`<button type="button" class="list-row list-row-btn" data-action="editRead" data-index="${i}">
                    <span style="width:44px;height:44px;border-radius:22px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font:700 17px var(--display);${raw(r.rating ? 'background:var(--accent);color:var(--accent-ink)' : 'border:1.5px solid var(--line)')}" aria-label="${r.rating ? `Rated ${r.rating} out of 10` : 'Not rated'}">${r.rating ?? '–'}</span>
                    <span class="grow stack-sm" style="gap:2px"><span>${r.abandonedAt ? 'DNF' : r.reread || i > 0 ? 'Re-read' : finished.length > 1 ? 'First read' : 'Read'}${r.formats?.length ? ` · ${r.formats.length > 1 ? `hybrid: ${listJoin(r.formats)}` : r.formats[0]}` : ''}</span>
                    <span class="small muted" style="font-weight:500">${readDates(r)}</span></span><span class="small accent">Edit</span></button>`)}</div>
                ${lib?.review ? html`<p style="font:16px/1.5 var(--display)">“${lib.review}”</p>` : ''}
                ${finished.some(({ r }) => r.moods?.length) ? html`<span class="small muted">Your moods: ${[...new Set(finished.flatMap(({ r }) => r.moods || []))].join(', ')}</span>` : ''}</section>` : ''}

            ${seriesList.length ? html`<section class="stack-sm"><div class="row-between"><h2 class="eyebrow">In this series</h2><a class="btn-link" href="${b.series?.id ? `#/series/hc_${b.series.id}` : `#/series/name/${encodeURIComponent(b.series?.name || '')}`}">See the whole series</a></div><div class="list">${seriesList.map((sb) => {
                const mine = store.get('books', sb.key);
                const sbRel = releaseInfo(sb);
                const future = sbRel.date && sbRel.date > today;
                return html`<a class="list-row" href="${bookHref(sb)}" ${sb.key === key ? raw('aria-current="page" style="background:var(--surface-2)"') : ''}>
                    <span class="small strong muted" style="width:52px">Book ${sb.series.position}</span>${cover(sb, { size: 'xs', label: false })}
                    <span class="grow stack-sm" style="gap:0"><span class="strong">${sb.title}</span>${future ? html`<span class="small muted">${sbRel.label}</span>` : ''}</span>
                    <span class="small strong ${mine?.rating ? 'accent' : 'muted'}">${mine?.status === 'read' && mine.rating ? `You: ${mine.rating}` : mine?.status === 'want' ? 'TBR' : mine?.status === 'reading' ? 'Reading' : future ? 'Coming' : ''}</span></a>`;
            })}</div></section>` : ''}

            ${!seriesList.length && b.series?.name ? html`<a class="card row-between" href="${b.series.id ? `#/series/hc_${b.series.id}` : `#/series/name/${encodeURIComponent(b.series.name)}`}"><span><span class="eyebrow">Series</span><br><span class="strong">${b.series.name}</span></span><span class="accent strong small">See the whole series</span></a>` : ''}
            <section class="list">${panels.map((p) => {
                const open = openPanels.has(p.id);
                const body = p.links ? p.links.map(([k, label, href]) => html`<div class="kv"><span>${k}</span><a class="accent" href="${href}" target="_blank" rel="noopener">${label}</a></div>`)
                    : (p.rows.length ? p.rows : [['', 'Not available yet']]).map(([k, v]) => html`<div class="kv"><span>${k}</span><span>${v}</span></div>`);
                return html`<div class="accordion"><button type="button" aria-expanded="${String(open)}" data-action="panel" data-id="${p.id}"><span class="stack-sm" style="gap:2px"><span>${p.title}</span><span class="small muted" style="font-weight:500">${p.hint}</span></span><span aria-hidden="true" class="muted" style="font-size:20px">${open ? '−' : '+'}</span></button>
                    ${open ? html`<div class="panel">${body}</div>` : ''}</div>`;
            })}</section>

            ${ex.similar?.length ? html`<section class="stack-sm"><h2 class="eyebrow">More like this</h2><span class="small muted">From Hardcover’s similar books, ordered by the moods you rate highly.</span>
                <div class="carousel">${rankSimilar(ex.similar, b).map((s) => html`<a href="${bookHref(s)}" class="stack-sm" style="width:104px;gap:6px">${cover(s, { size: 'fill', label: false })}<span class="small strong clamp-2">${s.title}</span><span class="small muted clamp-2">${similarReason(s, b)}</span></a>`)}</div></section>` : ''}

            <p class="small muted">Book information from ${b.verified ? 'Hardcover' : b.manual ? 'you' : 'Google Books'}${sources.length ? `. ${[...new Set(sources.map(([, s]) => SOURCE_NAMES[s]))].join(' and ')} filled in: ${sources.map(([f]) => ({ coverUrl: 'cover', description: 'description', isbn13: 'ISBN', pageCount: 'pages', publisher: 'publisher', releaseDate: 'release date', subtitle: 'subtitle' })[f]).filter(Boolean).join(', ')}` : ''}.</p>
        </div>`;
    },
    mount(root, { params }, rerender) {
        const key = decodeURIComponent(params.key);
        expandedAbout = false;
        const lib = store.get('books', key);
        if (lib?.isNew) store.save('books', key, { isNew: false });
        load(key, rerender);
    },
    handlers: {
        back() { history.length > 1 ? history.back() : (location.hash = '#/library'); },
        shelf(el, e, ctx) {
            const b = currentBook(ctx.key);
            if (!b) return;
            // "Read" needs a finished read (date and rating) to count in stats and the goal
            if (el.dataset.shelf === 'read' && store.get('books', ctx.key)?.status !== 'read') return openRateSheet({ ...b, key: ctx.key });
            setShelf({ ...b, key: ctx.key }, el.dataset.shelf);
        },
        start(el, e, ctx) { const b = currentBook(ctx.key); if (b) setShelf({ ...b, key: ctx.key }, 'reading'); },
        progress(el, e, ctx) { const b = store.get('books', ctx.key); if (b) openProgressSheet(b); },
        finish(el, e, ctx) { const b = currentBook(ctx.key); if (b) openRateSheet({ ...b, key: ctx.key }); },
        editRating(el, e, ctx) {
            const b = store.get('books', ctx.key);
            const idx = (b?.reads || []).map((r, i) => (isFinished(r) ? i : -1)).filter((i) => i >= 0).at(-1);
            if (b) openRateSheet(b, { readIndex: idx ?? null });
        },
        editRead(el, e, ctx) { const b = store.get('books', ctx.key); if (b) openRateSheet(b, { readIndex: Number(el.dataset.index) }); },
        reread(el, e, ctx) { const b = currentBook(ctx.key); if (b) startReread({ ...b, key: ctx.key }); },
        remove(el, e, ctx) { removeBook(ctx.key); },
        setDate(el, e, ctx) { const b = currentBook(ctx.key); if (b) openReleaseDateSheet({ ...b, key: ctx.key }); },
        async acceptDate(el, e, ctx) {
            const b = store.get('books', ctx.key);
            await clearReleaseOverride(ctx.key);
            await store.save('books', ctx.key, { releaseDate: b.pendingDate.date, datePrecision: 'day', pendingDate: null });
        },
        keepDate(el, e, ctx) { store.save('books', ctx.key, { pendingDate: null }); },
        panel(el) { const id = el.dataset.id; openPanels.has(id) ? openPanels.delete(id) : openPanels.add(id); window.dispatchEvent(new Event('bt:rerender')); },
        about() { expandedAbout = !expandedAbout; window.dispatchEvent(new Event('bt:rerender')); },
    },
    context: ({ params }) => ({ key: decodeURIComponent(params.key) }),
};

function readDates(r) {
    const today = todayIso();
    if (!r.finishedAt && !r.abandonedAt && r.finishedYear) return `Read in ${r.finishedYear}`;
    if (!r.finishedAt && !r.abandonedAt && r.dateUnknown) return 'Read · date not recorded';
    const end = r.finishedAt || r.abandonedAt;
    if (r.startedAt && end) {
        const days = daysBetween(r.startedAt, end) + 1;
        return `${formatDay(r.startedAt, today, { weekday: false })} to ${formatDay(end, today, { weekday: false })} · ${plural(days, 'day')}`;
    }
    return end ? `Finished ${formatDay(end, today, { weekday: false })}` : 'No dates recorded';
}

const HERO = ['#2f5d62', '#4a3f6b', '#3d5a80', '#6b3e5e', '#1f4e5f', '#556b3a', '#7a3b2e', '#2c4d6b'];
function heroColour(b) {
    let h = 0;
    for (const c of (b.title || '') + (b.authors?.[0]?.name || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
    return HERO[Math.abs(h) % HERO.length];
}

