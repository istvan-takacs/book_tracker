import { html, icon, cover, authorLinks, seriesLabel, plural, toast } from '../ui.js';
import { store } from '../store.js';
import { bookHref, releaseInfo, calendarLink, hardcoverBanner } from '../components.js';
import { sourceStatus, hardcoverAvailable } from '../api.js';
import { checkReleases, lastChecked } from '../releases.js';
import { timeframe, todayIso, effectiveRelease, firstWeekday, MONTHS, parseDay, toIso } from '../lib/dates.js';
import { setShelf } from '../actions.js';
import { openReleaseDateSheet } from '../sheets/releaseDate.js';

const GROUPS = [['thisWeek', 'This week'], ['thisMonth', 'This month'], ['later', 'Later'], ['recent', 'Recently released']];
const cal = { month: null, selected: null };
let banner = null;

function upcomingBooks() {
    return [...store.books.values()].filter((b) => b.status === 'upcoming' || (b.status === 'want' && effectiveRelease(b).date > todayIso()));
}

function card(b, today) {
    const r = releaseInfo(b, today);
    const group = timeframe(r, today);
    const badges = [
        b.isNew ? html`<span class="badge badge-new">NEW</span>` : '',
        !b.verified && !b.manual ? html`<span class="badge badge-muted">NOT YET CONFIRMED</span>` : '',
        r.manual ? html`<span class="badge badge-accent">SET BY YOU</span>` : '',
        b.status === 'want' ? html`<span class="badge badge-accent">ON YOUR TBR</span>` : '',
    ].filter(Boolean);
    let actions;
    if (group === 'recent') {
        actions = html`${b.status !== 'want' ? html`<button type="button" class="btn btn-primary btn-sm" data-action="tbr" data-key="${b.key}">Add to TBR</button>` : ''}<button type="button" class="btn btn-sm" data-action="start" data-key="${b.key}">Start reading</button>`;
    } else if (r.exact) {
        actions = calendarLink(b);
    } else {
        actions = html`<button type="button" class="btn btn-outline btn-sm" data-action="setDate" data-key="${b.key}">Set date</button>`;
    }
    return html`<article class="book-row">
        <a href="${bookHref(b)}" aria-label="Open ${b.title}">${cover(b, { size: 'md', label: false })}</a>
        <div class="meta">
            ${badges.length ? html`<div class="row wrap" style="gap:6px">${badges}</div>` : ''}
            <a class="title-sm clamp-2" href="${bookHref(b)}">${b.title}</a>
            <span class="small muted">${[b.series?.name ? seriesLabel(b.series) : null].filter(Boolean).join('')}${b.series?.name && b.authors?.length ? ' · ' : ''}${authorLinks(b.authors)}</span>
            <span><span class="strong">${group === 'recent' ? `Out since ${r.label.replace(/^\w+day /, '')}` : r.label}</span>${r.when ? html`<br><span class="small strong ${group === 'recent' ? 'sage' : 'accent'}">${r.when}</span>` : r.exact ? '' : html`<br><span class="small muted">No exact date yet</span>`}</span>
            <div class="actions">${actions}</div>
        </div></article>`;
}

function timeline(today) {
    const books = upcomingBooks();
    const grouped = Object.fromEntries(GROUPS.map(([id]) => [id, []]));
    for (const b of books) {
        const g = timeframe(effectiveRelease(b), today);
        if (g in grouped) grouped[g].push(b);
    }
    const key = (b) => effectiveRelease(b).date || '9999';
    for (const g of Object.values(grouped)) g.sort((a, b) => key(a).localeCompare(key(b)));
    grouped.recent.reverse();
    const any = GROUPS.some(([id]) => grouped[id].length);
    const follows = [...store.authors.values()].filter((a) => a.followed).length + [...store.series.values()].filter((s) => s.followed).length;
    if (!any) {
        return html`<div class="empty card"><h2 class="title-md">Nothing coming up yet</h2>
            <p class="muted">${follows ? `You follow ${plural(follows, 'author or series', 'authors and series')}. New books appear here as soon as they’re announced.` : 'Rate a book 6 or higher and its author is followed automatically. Their new books then appear here.'}</p>
            ${follows ? '' : html`<a class="btn btn-primary" href="#/library?shelf=read">Rate a book you’ve read</a>`}
            <a class="btn" href="#/search">Find an author to follow</a></div>`;
    }
    return html`${GROUPS.filter(([id]) => grouped[id].length).map(([id, label]) => html`<section class="stack-sm"><h2 class="eyebrow">${label}</h2>${grouped[id].map((b) => card(b, today))}</section>`)}
        <p class="small muted">Found a date online for a book that only has a year or month? Tap Set date to add it yourself. “Not yet confirmed” means only Google Books lists the book so far; it updates once Hardcover has it.</p>`;
}

function calendar(today) {
    const books = upcomingBooks();
    const byDay = new Map();
    for (const b of books) {
        const r = effectiveRelease(b);
        if (r.date && r.precision === 'day') byDay.set(r.date, [...(byDay.get(r.date) || []), b]);
    }
    const undated = books.filter((b) => effectiveRelease(b).precision !== 'day');
    const [y, m] = (cal.month || today.slice(0, 7)).split('-').map(Number);
    const first = firstWeekday(navigator.language);
    const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const lead = (startDow - first + 7) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const dowFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const selected = cal.selected || (byDay.has(today) ? today : [...byDay.keys()].filter((d) => d >= today).sort()[0] || today);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(html`<span></span>`);
    for (let d = 1; d <= days; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const has = byDay.has(iso);
        cells.push(html`<button type="button" class="cal-day${has ? ' has' : ''}${iso === today ? ' today' : ''}" aria-pressed="${String(iso === selected)}" data-action="day" data-day="${iso}" aria-label="${d} ${MONTHS[m - 1]}${has ? `, ${plural(byDay.get(iso).length, 'release')}` : ''}${iso === today ? ', today' : ''}">${d}<span class="dot" aria-hidden="true"></span></button>`);
    }
    const list = byDay.get(selected) || [];
    const selDate = new Date(parseDay(selected));
    return html`<section class="card stack-sm">
            <div class="row-between"><button type="button" class="btn btn-icon" style="border:0" aria-label="Previous month" data-action="month" data-delta="-1">${icon('back', 20)}</button>
                <h2 class="title-sm">${MONTHS[m - 1]} ${y}</h2>
                <button type="button" class="btn btn-icon" style="border:0" aria-label="Next month" data-action="month" data-delta="1">${icon('next', 20)}</button></div>
            <div class="cal-grid">${Array.from({ length: 7 }, (_, i) => html`<span class="dow" aria-hidden="true">${dows[(first + i) % 7]}</span>`)}${cells}</div>
        </section>
        <section class="stack-sm"><h2 class="eyebrow">${dowFull[selDate.getUTCDay()]} ${selDate.getUTCDate()} ${MONTHS[selDate.getUTCMonth()]}</h2>
            ${list.length ? list.map((b) => card(b, today)) : html`<p class="card muted">No releases on this day. Days with a dot have one.</p>`}</section>
        ${undated.length ? html`<section class="stack-sm"><h2 class="eyebrow">No exact date yet</h2>${undated.map((b) => card(b, today))}</section>` : ''}`;
}

export default {
    tab: 'upcoming',
    render({ params }) {
        const today = todayIso();
        const mode = params.mode === 'calendar' ? 'calendar' : 'timeline';
        const last = lastChecked();
        return html`<div class="stack">
            <div class="row-between"><h1 class="title">Upcoming</h1>
                <div class="row" style="gap:8px">
                    <button type="button" class="btn btn-icon" style="background:var(--surface)" aria-label="Check for new releases" data-action="refresh">${icon('refresh', 20)}</button>
                    <a class="btn btn-sm" style="background:var(--surface)" href="#/settings/calendar">${icon('calendar', 18)}Calendar sync</a>
                </div></div>
            <nav class="segmented" aria-label="View"><a href="#/upcoming" ${mode === 'timeline' ? html`aria-current="page"` : ''}>Timeline</a><a href="#/upcoming/calendar" ${mode === 'calendar' ? html`aria-current="page"` : ''}>Calendar</a></nav>
            ${hardcoverBanner(sourceStatus)}
            ${banner ? html`<div class="banner banner-sage" role="status"><span class="grow strong">${banner}</span><button type="button" class="btn btn-icon" style="border:0;width:40px;height:40px;color:inherit" aria-label="Dismiss" data-action="dismiss">${icon('close', 18)}</button></div>` : ''}
            ${!hardcoverAvailable() ? html`<p class="banner banner-plain">New releases are found through Hardcover, which isn’t connected yet. Books you add yourself still appear here.</p>` : ''}
            ${mode === 'calendar' ? calendar(today) : timeline(today)}
            ${last ? html`<p class="small muted" style="text-align:center">Last checked for new releases ${last.toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}</p>` : ''}
        </div>`;
    },
    mount() {
        // clear NEW badges a moment after you've seen them
        const fresh = [...store.books.values()].filter((b) => b.isNew);
        const t = fresh.length ? setTimeout(() => store.batch(fresh.map((b) => ({ collection: 'books', key: b.key, patch: { isNew: false } }))), 4000) : null;
        checkReleases().then((r) => { if (r?.added) { banner = `${plural(r.added, 'new release')} found from authors and series you follow`; window.dispatchEvent(new Event('bt:rerender')); } }).catch(() => null);
        return () => clearTimeout(t);
    },
    handlers: {
        async refresh(el) {
            el.disabled = true;
            const r = await checkReleases({ force: true }).catch(() => null);
            el.disabled = false;
            banner = r?.skipped === 'unavailable' ? null : r?.added ? `${plural(r.added, 'new release')} found` : 'You’re up to date. No new releases since the last check.';
            if (!banner) toast('Hardcover isn’t connected, so new releases can’t be checked yet.');
            window.dispatchEvent(new Event('bt:rerender'));
        },
        dismiss() { banner = null; window.dispatchEvent(new Event('bt:rerender')); },
        tbr(el) { const b = store.get('books', el.dataset.key); if (b) setShelf(b, 'want'); },
        start(el) { const b = store.get('books', el.dataset.key); if (b) setShelf(b, 'reading'); },
        setDate(el) { const b = store.get('books', el.dataset.key); if (b) openReleaseDateSheet(b); },
        day(el) { cal.selected = el.dataset.day; window.dispatchEvent(new Event('bt:rerender')); },
        month(el) {
            const today = todayIso();
            const [y, m] = (cal.month || today.slice(0, 7)).split('-').map(Number);
            const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.delta), 1));
            cal.month = toIso(d.getTime()).slice(0, 7);
            cal.selected = null;
            window.dispatchEvent(new Event('bt:rerender'));
        },
    },
};
