import { html, plural, fmtNumber } from '../ui.js';
import { store } from '../store.js';
import { computeStats, goalProgress, readYear } from '../lib/stats.js';
import { todayIso, MONTHS } from '../lib/dates.js';
import { goalRing } from '../components.js';

let selectedMonth = null;

export default {
    tab: 'stats',
    render({ query }) {
        const today = todayIso();
        const books = [...store.books.values()];
        const years = [...new Set(books.flatMap((b) => (b.reads || []).map((r) => readYear(r)).filter(Boolean).map(String)))].sort().reverse();
        if (!years.includes(today.slice(0, 4))) years.unshift(today.slice(0, 4));
        const year = query.get('year') || today.slice(0, 4);
        const all = year === 'all';
        const s = computeStats(books, { year: all ? null : year });
        const goal = !all ? store.settings.goals?.[year] : null;
        const g = goal ? goalProgress(s.books, goal, year === today.slice(0, 4) ? today : `${year}-12-31`) : null;
        const maxMonth = Math.max(1, ...s.perMonth);
        const sel = selectedMonth ?? (year === today.slice(0, 4) ? Number(today.slice(5, 7)) - 1 : 11);
        const maxRating = Math.max(1, ...Object.values(s.ratingDistribution));
        const formatRows = [['Print', s.formats.print], ['Ebook', s.formats.ebook], ['Audio', s.formats.audio], ['Mixed', s.formats.mixed]];
        const maxFormat = Math.max(1, ...formatRows.map(([, n]) => n));

        const yearSelect = html`<label class="chip" style="gap:4px">Year<select class="select" style="min-height:0;padding:0;border:0;background:transparent;width:auto;font-weight:700" data-action="year" data-on="change">
            ${years.map((y) => html`<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)}<option value="all" ${all ? 'selected' : ''}>All time</option></select></label>`;

        if (!s.books) {
            return html`<div class="stack"><div class="row-between"><h1 class="title">Stats</h1>${yearSelect}</div>
                <div class="empty card"><h2 class="title-md">No finished books ${all ? 'yet' : `in ${year}`}</h2>
                <p class="muted">Finish and rate a book to start your stats. “What you rate highest” appears once 3 or more books share a mood.</p>
                <a class="btn btn-primary" href="#/library?shelf=reading">Go to what you’re reading</a></div></div>`;
        }

        return html`<div class="stack">
            <div class="row-between"><h1 class="title">Stats</h1>${yearSelect}</div>
            <section aria-label="Summary" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
                <div class="card card-tight stack-sm" style="gap:2px"><span style="font:600 28px var(--display)">${s.books}</span><span class="small muted">${s.books === 1 ? 'book finished' : 'books finished'}</span></div>
                <div class="card card-tight stack-sm" style="gap:2px"><span style="font:600 28px var(--display)">${fmtNumber(s.pages)}</span><span class="small muted">pages read</span></div>
                <div class="card card-tight stack-sm" style="gap:2px"><span style="font:600 28px var(--display)">${s.averageRating ?? '–'}</span><span class="small muted">average rating out of 10</span></div>
            </section>
            ${g ? html`<section class="card row" style="gap:16px">${goalRing(g)}<div class="stack-sm" style="gap:4px"><span class="title-sm">${g.read} of ${plural(g.goal, 'book')}</span><span class="small muted">${year} reading goal · <a class="accent" href="#/settings/goal">Change</a></span></div></section>` : ''}

            ${!all ? html`<section class="card stack-sm">
                <div class="row-between"><h2 class="strong">Books finished per month</h2><span class="small muted" role="status">${MONTHS[sel]}: ${plural(s.perMonth[sel], 'book')}</span></div>
                <div style="position:relative;height:140px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:2px;align-items:end;border-bottom:1px solid var(--line)">
                    ${s.perMonth.map((n, i) => html`<button type="button" data-action="month" data-m="${i}" aria-label="${MONTHS[i]}: ${plural(n, 'book')}" style="height:140px;border:0;padding:0 3px;background:transparent;display:flex;align-items:flex-end">
                        <span style="display:block;width:100%;height:${Math.round((n / maxMonth) * 100)}%;min-height:${n ? 4 : 0}px;border-radius:4px 4px 0 0;background:var(--accent);opacity:${i === sel ? 1 : 0.55}"></span></button>`)}
                </div>
                <div aria-hidden="true" style="display:grid;grid-template-columns:repeat(12,minmax(0,1fr));text-align:center;font-size:11px" class="muted">${MONTHS.map((m) => html`<span>${m[0]}</span>`)}</div>
            </section>` : ''}

            <section class="card stack-sm"><h2 class="strong">Your ratings</h2><span class="small muted">How many books you gave each score out of 10</span>
                ${Object.entries(s.ratingDistribution).reverse().filter(([r, n]) => n || Number(r) >= 5).map(([r, n]) => html`<div class="bar-row"><span style="font:700 14px var(--display);text-align:right">${r}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.round((n / maxRating) * 100)}%"></span></span><span class="small muted">${n}</span></div>`)}
            </section>

            <section style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div class="card card-tight stack-sm" style="gap:4px"><span class="small muted">Average length</span><span class="title-sm">${s.averageLength ? `${fmtNumber(s.averageLength)} pages` : '–'}</span></div>
                <div class="card card-tight stack-sm" style="gap:4px"><span class="small muted">Time to finish a book</span><span class="title-sm">${s.averageDaysToFinish ? plural(s.averageDaysToFinish, 'day') : 'Add start dates to see this'}</span></div>
            </section>

            <section class="card stack-sm" style="--label-w:60px"><h2 class="strong">How you read</h2><span class="small muted">A hybrid read counts once under each format it used. Mixed is how many reads used more than one.</span>
                ${formatRows.map(([l, n]) => html`<div class="bar-row"><span>${l}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.round((n / maxFormat) * 100)}%"></span></span><span class="small muted">${n}</span></div>`)}
            </section>

            <section class="card stack-sm" style="--label-w:140px"><h2 class="strong">What you rate highest</h2>
                ${s.tastes.length ? html`<span class="small muted">Your average rating for books with each mood or feel. Only moods on 3 or more books are shown.</span>
                    ${s.tastes.slice(0, 6).map((t) => html`<div class="bar-row"><span>${t.label} (${t.count})</span><span class="bar-track"><span class="bar-fill" style="width:${t.average * 10}%"></span></span><span class="strong" style="font-family:var(--display)">${t.average}</span></div>`)}
                    ${s.tastes.length >= 2 ? html`<span class="small muted">You enjoy ${s.tastes[0].label.toLowerCase()} books the most${s.tastes.at(-1).average < s.tastes[0].average ? `; ${s.tastes.at(-1).label.toLowerCase()} books score lowest` : ''}.</span>` : ''}`
                : html`<span class="small muted">Add moods or “How did it feel?” when you finish books. Once 3 books share one, you’ll see how you rate them here.</span>`}
            </section>

            <section class="card stack-sm"><h2 class="strong">Top authors</h2>
                ${s.topAuthors.map((a) => html`<div class="row-between"><span>${a.name}</span><span class="small muted">${plural(a.count, 'book')}${a.average != null ? ` · ${a.count > 1 ? 'average' : 'rated'} ${a.average}` : ''}</span></div>`)}
                ${s.moods.length ? html`<h2 class="strong" style="margin-top:6px">Moods</h2><div class="chips">${s.moods.slice(0, 8).map((m) => html`<span class="tag">${m.mood} · ${plural(m.count, 'book')}</span>`)}</div>` : ''}
            </section>
        </div>`;
    },
    handlers: {
        year(el) { selectedMonth = null; location.hash = `#/stats?year=${el.value}`; },
        month(el) { selectedMonth = Number(el.dataset.m); window.dispatchEvent(new Event('bt:rerender')); },
    },
};
