import { html, icon, cover, plural } from '../ui.js';
import { store } from '../store.js';
import { authorDetails, findAuthorByName, hardcoverAvailable } from '../api.js';
import { bookHref, releaseInfo, calendarLink } from '../components.js';
import { followAuthorAction, unfollowAuthor, setShelf } from '../actions.js';
import { normalize } from '../lib/text.js';
import { todayIso } from '../lib/dates.js';

const cache = new Map();
let bioOpen = false;

function parseParam(params) {
    if (params.key?.startsWith('hc_')) return { id: Number(params.key.slice(3)), name: null };
    return { id: null, name: decodeURIComponent(params.name || '') };
}

async function load(params, rerender) {
    const p = parseParam(params);
    const k = p.id ? `id:${p.id}` : `name:${p.name}`;
    if (cache.has(k)) return;
    cache.set(k, { loading: true });
    try {
        let id = p.id;
        if (!id && p.name && hardcoverAvailable()) id = await findAuthorByName(p.name);
        cache.set(k, id ? { data: await authorDetails(id) } : { data: null });
    } catch (e) {
        cache.set(k, { data: null, error: e.code || 'error' });
    }
    rerender();
}

export default {
    tab: 'library',
    render({ params }) {
        const p = parseParam(params);
        const k = p.id ? `id:${p.id}` : `name:${p.name}`;
        const entry = cache.get(k) || { loading: true };
        const data = entry.data;
        const name = data?.name || p.name || [...store.authors.values()].find((a) => a.hardcoverId === p.id)?.name || 'Author';
        const n = normalize(name);
        const mine = [...store.books.values()].filter((b) => b.authors?.some((a) => normalize(a.name) === n));
        const books = data?.books || [];
        const merged = new Map(books.map((b) => [b.key, b]));
        for (const b of mine) if (!merged.has(b.key) && ![...merged.values()].some((x) => normalize(x.title) === normalize(b.title))) merged.set(b.key, b);
        const all = [...merged.values()];
        const read = mine.filter((b) => b.status === 'read');
        const rated = read.filter((b) => b.rating != null);
        const avg = rated.length ? Math.round((rated.reduce((s, b) => s + b.rating, 0) / rated.length) * 10) / 10 : null;
        const today = todayIso();
        const upcoming = all.filter((b) => {
            const lib = store.get('books', b.key);
            const r = releaseInfo(lib || b);
            return r.date ? r.date >= today : lib?.status === 'upcoming';
        })
            .sort((a, b) => (releaseInfo(a).date || '9').localeCompare(releaseInfo(b).date || '9'));
        const next = upcoming[0];
        const followed = [...store.authors.values()].find((a) => a.followed && (a.hardcoverId === (data?.hardcoverId ?? p.id) || normalize(a.name) === n));
        const totalBooks = data?.booksCount || all.length;

        // group by series, reading order; standalones after
        const seriesGroups = new Map();
        const standalone = [];
        for (const b of all) {
            if (b.series?.name && b.series.position != null) {
                const g = seriesGroups.get(b.series.name) || [];
                if (!g.some((x) => x.series.position === b.series.position)) g.push(b);
                seriesGroups.set(b.series.name, g);
            } else standalone.push(b);
        }
        const notInLibrary = standalone.filter((b) => !store.get('books', b.key));
        const bio = data?.bio || '';

        return html`<div class="stack">
            <a class="back-link" href="#" data-action="back">${icon('back')}Back</a>
            <header class="row" style="gap:16px">
                ${data?.imageUrl ? html`<img src="${data.imageUrl}" alt="" width="76" height="76" style="border-radius:38px;object-fit:cover;flex:0 0 auto" referrerpolicy="no-referrer">`
                    : html`<span style="flex:0 0 76px;height:76px;border-radius:38px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font:600 28px var(--display)">${name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>`}
                <div class="stack-sm grow" style="gap:6px"><h1 class="title" style="font-size:28px">${name}</h1>
                    <span class="small muted">${[totalBooks ? plural(totalBooks, 'book') : null, seriesGroups.size ? plural(seriesGroups.size, 'series', 'series') : null, data?.location].filter(Boolean).join(' · ')}</span></div>
            </header>
            <div class="stack-sm" style="gap:6px">
                <button type="button" class="btn btn-block ${followed ? '' : 'btn-primary'}" aria-pressed="${String(!!followed)}" data-action="${followed ? 'unfollow' : 'follow'}">${followed ? '✓ Following' : 'Follow for new releases'}</button>
                <span class="small muted">Following means their new books show up in Upcoming automatically.</span>
            </div>

            <section class="stack-sm" aria-labelledby="you-and"><h2 id="you-and" class="eyebrow">You and ${name}</h2>
                <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
                    <div class="card card-tight stack-sm" style="gap:4px"><span style="font:600 26px var(--display)">${read.length}${totalBooks ? html` <span class="muted" style="font-size:15px">of ${totalBooks}</span>` : ''}</span><span class="small">books of theirs you’ve read</span></div>
                    <div class="card card-tight stack-sm" style="gap:4px"><span style="font:600 26px var(--display)">${avg ?? '–'}${avg != null ? html` <span class="muted" style="font-size:15px">/ 10</span>` : ''}</span><span class="small">your average rating of their books</span></div>
                    <div class="card card-tight stack-sm" style="gap:4px"><span style="font:600 26px var(--display)">${upcoming.length}</span><span class="small">${upcoming.length === 1 ? 'new book coming out' : 'new books coming out'}</span></div>
                </div>
                ${rated.length ? html`<span class="small muted">Your average comes from ${rated.map((b) => `the ${b.rating} you gave ${b.title}`).join(rated.length === 2 ? ' and ' : ', ')}.</span>` : ''}
            </section>

            ${bio ? html`<section class="stack-sm"><h2 class="eyebrow">About the author</h2>
                <p class="prose">${bioOpen || bio.length < 320 ? bio : bio.slice(0, 280).replace(/\s+\S*$/, '') + '…'}</p>
                <div class="row">${bio.length >= 320 ? html`<button type="button" class="btn-link" data-action="bio">${bioOpen ? 'Show less' : 'Read more'}</button>` : ''}
                ${data?.slug ? html`<a class="btn-link" href="https://hardcover.app/authors/${data.slug}" target="_blank" rel="noopener">View on Hardcover</a>` : ''}</div></section>` : ''}

            ${entry.loading ? html`<div class="skeleton"></div>` : ''}
            ${!entry.loading && !data && !mine.length ? html`<p class="muted">${hardcoverAvailable() ? 'We couldn’t find this author on Hardcover.' : 'Author details need the Hardcover connection. Showing books from your library.'}</p>` : ''}

            ${next ? html`<section class="stack-sm"><h2 class="eyebrow">Next release</h2>
                <div class="book-row"><a href="${bookHref(next)}">${cover(next, { size: 'sm', label: false })}</a>
                    <div class="meta"><a class="title-sm" href="${bookHref(next)}">${next.title}</a>
                    ${next.series?.name ? html`<span class="small muted">${next.series.name}, book ${next.series.position}</span>` : ''}
                    <span class="small accent strong">${releaseInfo(store.get('books', next.key) || next).label}${releaseInfo(next).when ? ` · ${releaseInfo(next).when}` : ''}</span></div>
                    ${calendarLink(store.get('books', next.key) || next, { compact: true })}</div></section>` : ''}

            ${[...seriesGroups.entries()].map(([sname, list]) => {
                list.sort((a, b) => a.series.position - b.series.position);
                const readCount = list.filter((b) => store.get('books', b.key)?.status === 'read').length;
                const sid = list.find((b) => b.series?.id)?.series.id;
                return html`<section class="stack-sm"><div class="row-between"><h2 class="eyebrow">${sname}</h2><a class="btn-link small" href="${sid ? `#/series/hc_${sid}` : `#/series/name/${encodeURIComponent(sname)}`}">Read ${readCount} of ${list.length} · See series</a></div>
                <div class="list">${list.map((b) => {
                    const lib = store.get('books', b.key);
                    const r = releaseInfo(lib || b);
                    const right = lib?.status === 'read' && lib.rating ? `You: ${lib.rating}` : lib?.status === 'want' ? 'TBR' : lib?.status === 'reading' ? 'Reading' : r.date && r.date > today ? 'Coming soon' : '';
                    return html`<a class="list-row" href="${bookHref(b)}"><span class="small strong muted" style="width:52px">Book ${b.series.position}</span>${cover(b, { size: 'xs', label: false })}
                        <span class="grow stack-sm" style="gap:0"><span class="strong">${b.title}</span><span class="small muted">${lib ? '' : r.label}</span></span><span class="small strong ${right === 'Coming soon' ? 'sage' : 'accent'}">${right}</span></a>`;
                })}</div></section>`;
            })}

            ${standalone.length ? html`<section class="stack-sm"><h2 class="eyebrow">More by ${name}</h2><div class="list">${standalone.slice(0, 20).map((b) => {
                const lib = store.get('books', b.key);
                return html`<div class="list-row"><a href="${bookHref(b)}" aria-label="Open ${b.title}">${cover(b, { size: 'sm', label: false })}</a>
                    <a class="grow stack-sm" style="gap:2px" href="${bookHref(b)}"><span class="strong">${b.title}</span><span class="small muted">${[b.releaseDate?.slice(0, 4), lib ? null : 'not in your library yet'].filter(Boolean).join(' · ')}</span></a>
                    ${lib ? html`<span class="small sage strong">${lib.status === 'read' && lib.rating ? `You: ${lib.rating}` : { want: 'On your TBR', reading: 'Reading', dnf: 'DNF', upcoming: 'Coming soon' }[lib.status] || ''}</span>` : html`<button type="button" class="btn btn-outline btn-sm" data-action="tbr" data-key="${b.key}">Add to TBR</button>`}</div>`;
            })}</div></section>` : ''}
            ${notInLibrary.length > 20 ? html`<p class="small muted">Showing the 20 most popular.</p>` : ''}
            <p class="small muted">${data ? 'Author information from Hardcover.' : ''}</p>
        </div>`;
    },
    mount(root, { params }, rerender) { bioOpen = false; load(params, rerender); },
    context: ({ params }) => {
        const p = parseParam(params);
        const k = p.id ? `id:${p.id}` : `name:${p.name}`;
        return { p, data: cache.get(k)?.data };
    },
    handlers: {
        back() { history.length > 1 ? history.back() : (location.hash = '#/library/authors'); },
        follow(el, e, ctx) { followAuthorAction({ id: ctx.data?.hardcoverId ?? ctx.p.id, name: ctx.data?.name || ctx.p.name }); },
        unfollow(el, e, ctx) {
            const name = ctx.data?.name || ctx.p.name;
            const a = [...store.authors.values()].find((x) => x.followed && (x.hardcoverId === (ctx.data?.hardcoverId ?? ctx.p.id) || normalize(x.name) === normalize(name)));
            if (a) unfollowAuthor({ id: a.hardcoverId, name: a.name });
        },
        bio() { bioOpen = !bioOpen; window.dispatchEvent(new Event('bt:rerender')); },
        tbr(el, e, ctx) { const b = ctx.data?.books?.find((x) => x.key === el.dataset.key); if (b) setShelf(b, 'want'); },
    },
};

