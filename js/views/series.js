// Series page: every book in reading order with your ratings, progress,
// follow toggle, upcoming books, and "Mark books as read" for series you
// read in the past. Ratings can be changed in place, one tap per book.

import { html, icon, cover, plural, authorLink } from '../ui.js';
import { store } from '../store.js';
import { seriesBooks, hardcoverAvailable } from '../api.js';
import { bookHref, releaseInfo, calendarLink } from '../components.js';
import { setSeriesFollow, seriesKey, rateBookQuick } from '../actions.js';
import { normalize } from '../lib/text.js';
import { isFinished } from '../lib/stats.js';
import { todayIso } from '../lib/dates.js';
import { formatPosition } from '../ui.js';
import { openSeriesReadSheet } from '../sheets/seriesRead.js';

const cache = new Map();
const ui = { extras: false, ratingOpen: null };

function parse(params) {
    if (params.key?.startsWith('hc_')) return { id: Number(params.key.slice(3)), name: null };
    return { id: null, name: decodeURIComponent(params.name || '') };
}

async function load(p, rerender) {
    const k = p.id ? `id:${p.id}` : `name:${p.name}`;
    if (cache.has(k) || !p.id || !hardcoverAvailable()) return;
    cache.set(k, { loading: true });
    try {
        const [s] = await seriesBooks([p.id]);
        cache.set(k, { data: s || null });
    } catch (e) {
        cache.set(k, { data: null, error: e.code || 'error' });
    }
    rerender();
}

/** The series' books in order, merged with your library copies. */
export function seriesModel(p) {
    const k = p.id ? `id:${p.id}` : `name:${p.name}`;
    const entry = cache.get(k) || {};
    const remote = entry.data;
    const seriesDoc = p.id ? store.get('series', `hc_${p.id}`) : [...store.series.values()].find((s) => normalize(s.name) === normalize(p.name));
    const name = remote?.name || seriesDoc?.name || p.name || 'Series';
    const n = normalize(name);
    const library = [...store.books.values()].filter((b) => b.series && (p.id ? b.series.id === p.id || normalize(b.series.name) === n : normalize(b.series.name) === n));

    const byKey = new Map();
    for (const b of remote?.books || []) byKey.set(b.key, { ...b });
    for (const b of library) {
        // a library copy under a different key (e.g. found by ISBN) replaces the same position
        const twin = [...byKey.values()].find((x) => x.key !== b.key && x.series?.position != null && x.series.position === b.series.position && normalize(x.title) === normalize(b.title));
        if (twin) byKey.delete(twin.key);
        byKey.set(b.key, { ...(byKey.get(b.key) || {}), ...b, series: { ...(byKey.get(b.key)?.series || {}), ...b.series } });
    }
    // name-only or offline: fall back to the series doc's cached list
    if (!remote) for (const sb of seriesDoc?.books || []) if (!byKey.has(sb.key)) byKey.set(sb.key, { key: sb.key, title: sb.title, coverUrl: sb.coverUrl, releaseDate: sb.releaseDate, datePrecision: sb.datePrecision, series: { id: p.id, name, position: sb.position }, authors: (seriesDoc.authorNames || []).map((nm) => ({ id: null, name: nm })) });

    const all = [...byKey.values()].sort((a, b) => (a.series?.position ?? 999) - (b.series?.position ?? 999));
    const main = all.filter((b) => Number.isInteger(b.series?.position));
    const extras = all.filter((b) => !Number.isInteger(b.series?.position));
    const author = remote?.author ? { id: remote.author.id, name: remote.author.name } : all.find((b) => b.authors?.[0])?.authors?.[0] || null;
    return { entry, name, seriesDoc, main, extras, author, total: remote?.total || seriesDoc?.total || main.length, completed: remote?.completed ?? seriesDoc?.completed, id: p.id };
}

const libOf = (b) => store.get('books', b.key);
const isRead = (b) => (libOf(b)?.reads || []).some(isFinished) || libOf(b)?.status === 'read';

function row(b, today) {
    const lib = libOf(b);
    const rel = releaseInfo(lib || b, today);
    const future = rel.date && rel.date > today;
    const read = isRead(b);
    const status = read ? (lib?.rating ? null : 'Read') : lib?.status === 'reading' ? 'Reading' : lib?.status === 'want' ? 'On your TBR' : lib?.status === 'dnf' ? 'DNF' : future ? rel.label : null;
    const open = ui.ratingOpen === b.key;
    return html`<div class="stack-sm" style="gap:0">
        <div class="list-row">
            <span class="small strong muted" style="width:52px;flex:0 0 auto">${b.series?.position != null ? `Book ${formatPosition(b.series.position)}` : 'Extra'}</span>
            <a href="${bookHref(b)}" aria-label="Open ${b.title}">${cover(lib || b, { size: 'xs', label: false })}</a>
            <a class="grow stack-sm" style="gap:2px;min-width:0" href="${bookHref(b)}"><span class="strong">${b.title}</span>
                ${status ? html`<span class="small ${future ? 'accent' : 'muted'}">${status}${future && rel.when ? ` · ${rel.when}` : ''}</span>` : ''}</a>
            ${future ? calendarLink(lib || b, { compact: true })
                : html`<button type="button" class="btn btn-sm ${lib?.rating ? 'btn-soft' : ''}" aria-expanded="${String(open)}" data-action="rateChip" data-key="${b.key}" aria-label="${lib?.rating ? `Your rating ${lib.rating} out of 10. Change it` : `Rate ${b.title}`}">${lib?.rating ? `You: ${lib.rating}` : 'Rate'}</button>`}
        </div>
        ${open ? html`<div class="rating-grid" style="padding:0 14px 12px;grid-template-columns:repeat(10,minmax(0,1fr));gap:4px" role="group" aria-label="Rate ${b.title} out of 10">
            ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<button type="button" style="height:40px;font-size:15px;border-radius:10px" aria-pressed="${String(lib?.rating === n)}" data-action="setRating" data-key="${b.key}" data-n="${n}">${n}</button>`)}
        </div>` : ''}
    </div>`;
}

export default {
    tab: 'library',
    render({ params }) {
        const p = parse(params);
        const m = seriesModel(p);
        const today = todayIso();
        const readCount = m.main.filter(isRead).length;
        const total = Math.max(m.total || 0, m.main.length);
        const followed = !!(m.seriesDoc?.followed || [...store.series.values()].find((s) => s.followed && normalize(s.name) === normalize(m.name)));
        const released = m.main.filter((b) => { const r = releaseInfo(libOf(b) || b, today); return !r.date || r.date <= today; });
        const unreadReleased = released.filter((b) => !isRead(b));
        const rated = m.main.map((b) => libOf(b)?.rating).filter((r) => r != null);
        const avg = rated.length ? Math.round((rated.reduce((s, v) => s + v, 0) / rated.length) * 10) / 10 : null;

        return html`<div class="stack">
            <a class="back-link" href="#" data-action="back">${icon('back')}Back</a>
            <header class="stack-sm" style="gap:6px">
                <span class="eyebrow">Series</span>
                <h1 class="title" style="font-size:30px">${m.name}</h1>
                <span class="small muted">${m.author ? authorLink(m.author, 'author-link') : ''}${m.author ? ' · ' : ''}${total ? plural(total, 'book') : ''}${m.completed === true ? ' · finished series' : m.completed === false ? ' · ongoing' : ''}</span>
            </header>
            <div class="stack-sm" style="gap:6px">
                <button type="button" class="btn btn-block ${followed ? '' : 'btn-primary'}" aria-pressed="${String(followed)}" data-action="follow">${followed ? '✓ Following' : 'Follow for new books'}</button>
                <span class="small muted">Following means new books in this series show up in Upcoming.</span>
            </div>

            <section class="card stack-sm">
                <div class="row-between"><span class="title-sm">Read ${readCount} of ${total}</span>${avg != null ? html`<span class="small muted">Your average rating ${avg} out of 10</span>` : ''}</div>
                <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${readCount}" aria-label="Books read in this series"><span style="width:${total ? Math.round((readCount / total) * 100) : 0}%"></span></div>
                ${unreadReleased.length ? html`<button type="button" class="btn btn-primary" data-action="markRead">Mark books as read</button>
                    <span class="small muted">Read this series before? Mark several books at once, then fine-tune each rating below.</span>` : ''}
            </section>

            ${m.entry.loading && !m.main.length ? html`<div class="skeleton"></div>` : ''}
            ${!m.entry.loading && !m.main.length ? html`<p class="muted">${hardcoverAvailable() ? 'No books found for this series.' : 'The full series list needs the Hardcover connection. Showing the books in your library.'}</p>` : ''}

            ${m.main.length ? html`<section class="stack-sm"><h2 class="eyebrow">In reading order</h2><div class="list">${m.main.map((b) => row(b, today))}</div>
                <span class="small muted">Tap “Rate” or your rating to change it. Changes save straight away.</span></section>` : ''}

            ${m.extras.length ? html`<section class="stack-sm">
                <button type="button" class="btn-link" aria-expanded="${String(ui.extras)}" data-action="extras">${ui.extras ? 'Hide' : 'Show'} novellas and extras (${m.extras.length})</button>
                ${ui.extras ? html`<div class="list">${m.extras.map((b) => row(b, today))}</div>` : ''}</section>` : ''}
            ${m.entry.data ? html`<p class="small muted">Series information from Hardcover.</p>` : ''}
        </div>`;
    },
    mount(root, { params }, rerender) {
        ui.ratingOpen = null;
        ui.extras = false;
        load(parse(params), rerender);
    },
    context: ({ params }) => ({ p: parse(params) }),
    handlers: {
        back() { history.length > 1 ? history.back() : (location.hash = '#/library/series'); },
        follow(el, e, ctx) {
            const m = seriesModel(ctx.p);
            const key = m.id ? `hc_${m.id}` : seriesKey({ name: m.name });
            const followed = !!store.get('series', key)?.followed;
            setSeriesFollow({ id: m.id, name: m.name }, !followed);
        },
        markRead(el, e, ctx) {
            const m = seriesModel(ctx.p);
            openSeriesReadSheet({ id: m.id, name: m.name, author: m.author }, m.main);
        },
        rateChip(el) { ui.ratingOpen = ui.ratingOpen === el.dataset.key ? null : el.dataset.key; window.dispatchEvent(new Event('bt:rerender')); },
        setRating(el, e, ctx) {
            const m = seriesModel(ctx.p);
            const b = [...m.main, ...m.extras].find((x) => x.key === el.dataset.key);
            if (!b) return;
            ui.ratingOpen = null;
            rateBookQuick({ ...b, series: b.series || { id: m.id, name: m.name } }, Number(el.dataset.n));
        },
        extras() { ui.extras = !ui.extras; window.dispatchEvent(new Event('bt:rerender')); },
    },
};
