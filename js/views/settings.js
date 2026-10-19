import { html, icon, plural, toast } from '../ui.js';
import { store } from '../store.js';
import { services } from '../services.js';
import { sourceStatus, checkHardcover } from '../api.js';
import { importGoodreadsFile, followMany, exportCsv, exportJson, setGoal } from '../actions.js';
import { subscribeUrl, buildIcs, calendarBooks, releaseEvent } from '../lib/calendar.js';
import { checkReleases, lastChecked } from '../releases.js';
import { todayIso } from '../lib/dates.js';
import { workerUrl, appUrl } from '../../config.js';
import { seedSampleLibrary } from '../sample.js';

const ui = { importing: false, progress: null, result: null, picked: new Set(), confirmReset: false, copied: false, confirmPreviewReset: false };

const STATUS = {
    ok: ['sage', 'Connected · main source for books, series and dates'],
    unknown: ['muted', 'Not checked yet'],
    unconfigured: ['muted', 'Not set up yet. Search uses Google Books and Open Library (see README → Setup).'],
    token: ['warn', 'Needs a new access token. Showing your library and Google Books meanwhile.'],
    signin: ['warn', 'Your sign-in wasn’t accepted by the book data service. Try signing out and in again.'],
    limited: ['warn', 'Hourly limit reached. It recovers on its own within a minute or two.'],
    down: ['warn', 'Temporarily unavailable. Showing your library and Google Books meanwhile.'],
    offline: ['warn', 'You are offline.'],
};

function downloadIcs() {
    const events = calendarBooks([...store.books.values()], todayIso()).map(({ book, date }) => releaseEvent(book, date, { appUrl }));
    const url = URL.createObjectURL(new Blob([buildIcs(events)], { type: 'text/calendar' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'book-releases.ics' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Downloaded ${plural(events.length, 'release')}. Import it in Google Calendar → Settings → Import.`);
}

export default {
    tab: 'home',
    render({ params }) {
        const year = todayIso().slice(0, 4);
        const goal = store.settings.goals?.[year] || null;
        const feed = services.calendar.feedUrl();
        const [hcClass, hcText] = STATUS[sourceStatus.hardcover] || STATUS.unknown;
        const last = lastChecked();
        const theme = store.settings.theme || 'system';
        const r = ui.result;
        return html`<div class="stack">
            <a class="back-link" href="#/">${icon('back')}Home</a>
            <h1 class="title">Profile and settings</h1>

            <section class="card row" style="gap:14px">
                <span style="flex:0 0 52px;height:52px;border-radius:26px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-weight:700">${store.settings.displayName ? store.settings.displayName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() : 'Me'}</span>
                <span class="grow stack-sm" style="gap:2px">${services.mode === 'firebase'
                    ? html`<span class="strong">Signed in with Google</span><span class="small muted">${services.user?.email || ''} · your library syncs across devices</span>`
                    : html`<span class="strong">Preview mode</span><span class="small muted">Data stays in this browser. Add your Firebase config to sync (README → Setup).</span>`}</span>
                ${services.mode === 'firebase' ? html`<button type="button" class="btn btn-sm" data-action="signOut">Sign out</button>` : ''}
            </section>

            <section id="calendar" class="stack-sm"><h2 class="eyebrow">Calendar sync</h2>
                <div class="card stack-sm">
                    <span class="prose">Subscribe once and every dated release from your followed authors, series and TBR appears in Google Calendar, including dates you set yourself.</span>
                    ${services.calendar.available ? html`
                        <span class="small muted">Google refreshes subscribed calendars roughly every 12 to 24 hours, so changes can take up to a day to show.</span>
                        ${feed ? html`<a class="btn btn-primary" href="${subscribeUrl(feed)}" target="_blank" rel="noopener">Add to Google Calendar</a>
                            <div class="row card-tight" style="background:var(--surface-2);border-radius:12px"><span class="grow small muted ellipsis">${feed}</span><button type="button" class="btn btn-sm" style="background:var(--surface)" data-action="copy">${ui.copied ? '✓ Copied' : 'Copy link'}</button></div>
                            <span class="small muted">This link is private. Anyone who has it can see your upcoming releases.</span>
                            ${ui.confirmReset ? html`<div class="card stack-sm" role="alertdialog" aria-label="Reset calendar link" style="border:1.5px solid var(--accent)"><span class="small">Make a new link? The old one stops working, so you’ll need to subscribe again in Google Calendar.</span><div class="row"><button type="button" class="btn btn-primary btn-sm" data-action="doReset">Make new link</button><button type="button" class="btn btn-sm" data-action="cancelReset">Cancel</button></div></div>`
                            : html`<button type="button" class="btn-link" data-action="askReset">Make a new private link</button>`}`
                        : html`<button type="button" class="btn btn-primary" data-action="createFeed">Create my calendar link</button>`}`
                    : html`<span class="small muted">${services.mode === 'firebase' ? 'Needs the Worker to be set up (README → Calendar feed).' : 'Available once you sign in with Google.'} Meanwhile you can download your releases as a file.</span>`}
                    <button type="button" class="btn btn-sm" data-action="ics">${icon('download', 18)}Download all releases (.ics file)</button>
                </div></section>

            <section id="goal" class="stack-sm"><h2 class="eyebrow">Reading goal</h2>
                <div class="card row-between"><span><strong>${goal ? plural(goal, 'book') : 'No goal'}</strong> <span class="muted">in ${year}</span></span>
                    <div class="row" style="gap:6px"><button type="button" class="btn btn-icon" aria-label="Five fewer books" data-action="goal" data-d="-5">−</button><button type="button" class="btn btn-icon" aria-label="Five more books" data-action="goal" data-d="5">+</button>
                    ${goal ? html`<button type="button" class="btn-link" data-action="goalOff">Remove</button>` : ''}</div></div></section>

            <section id="import" class="stack-sm"><h2 class="eyebrow">Import and export</h2>
                <div class="card stack-sm">
                    <span class="strong">Import from Goodreads</span>
                    <ol class="small" style="margin:0;padding-left:18px;line-height:1.6"><li>On Goodreads, open <strong>My Books → Import and export</strong>.</li><li>Tap <strong>Export library</strong> and download the file.</li><li>Choose that file below. Ratings out of 5 are doubled to fit the 10-point scale.</li></ol>
                    ${ui.importing ? html`<div role="status" class="stack-sm"><span class="strong">Matching your books… ${ui.progress ? `${ui.progress.done} of ${ui.progress.total}` : ''}</span><div class="progress-bar"><span style="width:${ui.progress ? Math.round((ui.progress.done / ui.progress.total) * 100) : 5}%"></span></div><span class="small muted">You can keep using the app; this continues in the background.</span></div>`
                    : html`<label class="btn btn-outline" style="cursor:pointer">Choose your Goodreads file<input type="file" accept=".csv,text/csv" class="visually-hidden" data-action="importFile" data-on="change"></label>`}
                    ${store.settings.lastImportAt ? html`<span class="small muted">Last import ${new Date(store.settings.lastImportAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · ${plural(store.settings.lastImportCount || 0, 'book')}</span>` : ''}
                    ${r ? html`<div class="banner banner-sage stack-sm" role="status" style="display:flex;flex-direction:column"><span class="strong">Imported ${plural(r.summary.total, 'book')}</span><span>${r.summary.read} read, ${r.summary.want} on your TBR, ${r.summary.reading} reading, ${r.summary.dnf} DNF. ${r.summary.matched} matched to Hardcover or Google Books.</span></div>
                        ${r.suggestions.length ? html`<div class="stack-sm"><span class="strong">Follow these authors? You rated their books 6 or higher.</span>
                            <div class="list">${r.suggestions.map((a, i) => html`<label class="check" style="padding:0 14px"><input type="checkbox" data-action="pick" data-on="change" data-i="${i}" ${ui.picked.has(i) ? 'checked' : ''}>${a.name}</label>`)}</div>
                            <button type="button" class="btn btn-primary" data-action="followPicked">Follow ${ui.picked.size} selected</button></div>` : ''}` : ''}
                </div>
                <div class="list">
                    <button type="button" class="list-row list-row-btn" data-action="csv">${icon('download', 18)}<span class="grow">Download your library as a spreadsheet (CSV)</span></button>
                    <button type="button" class="list-row list-row-btn" data-action="json">${icon('download', 18)}<span class="grow">Download a full backup (JSON)</span></button>
                </div></section>

            <section class="stack-sm"><h2 class="eyebrow">Appearance</h2>
                <div class="segmented" role="radiogroup" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => html`<button type="button" role="radio" aria-checked="${String(theme === v)}" data-action="theme" data-v="${v}">${l}</button>`)}</div></section>

            <section class="stack-sm"><h2 class="eyebrow">Book data sources</h2>
                <div class="list">
                    <div class="list-row"><span aria-hidden="true" style="width:10px;height:10px;border-radius:5px;background:var(--${hcClass === 'muted' ? 'line' : hcClass})"></span>
                        <span class="grow stack-sm" style="gap:2px"><span class="strong">Hardcover</span><span class="small ${hcClass}">${hcText}</span>${sourceStatus.hardcoverMessage && hcClass === 'warn' ? html`<span class="small muted">${sourceStatus.hardcoverMessage}</span>` : ''}</span>
                        ${workerUrl ? html`<button type="button" class="btn btn-sm" data-action="recheck">Check</button>` : ''}</div>
                    <div class="list-row"><span aria-hidden="true" style="width:10px;height:10px;border-radius:5px;background:var(--sage)"></span>
                        <span class="grow stack-sm" style="gap:2px"><span class="strong">Google Books and Open Library</span><span class="small sage">Used to fill gaps</span></span></div>
                    <div class="list-row"><span class="grow small muted">${last ? `Last checked for new releases ${last.toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}` : 'Not checked for new releases yet'}</span><button type="button" class="btn-link" data-action="releases">Check now</button></div>
                </div></section>

            ${services.mode === 'preview' ? html`<section class="stack-sm"><h2 class="eyebrow">Preview mode</h2><div class="card stack-sm">
                <span class="small muted">Try the app with a small sample library, or clear everything stored in this browser.</span>
                <button type="button" class="btn" data-action="sample">Load a sample library</button>
                ${ui.confirmPreviewReset ? html`<div class="row"><button type="button" class="btn btn-primary btn-sm" data-action="doPreviewReset">Yes, clear it</button><button type="button" class="btn btn-sm" data-action="cancelPreviewReset">Cancel</button></div>` : html`<button type="button" class="btn" data-action="previewReset">Clear this browser’s data</button>`}
            </div></section>` : ''}
        </div>`;
    },
    mount(root, { params }) {
        if (params.section) root.querySelector(`#${params.section}`)?.scrollIntoView({ block: 'start' });
    },
    handlers: {
        signOut() { services.signOut(); },
        async createFeed() { await services.calendar.ensure(); window.dispatchEvent(new Event('bt:rerender')); },
        async copy() { try { await navigator.clipboard.writeText(services.calendar.feedUrl()); ui.copied = true; } catch { toast('Copy failed. Press and hold the link to copy it.'); } window.dispatchEvent(new Event('bt:rerender')); },
        askReset() { ui.confirmReset = true; window.dispatchEvent(new Event('bt:rerender')); },
        cancelReset() { ui.confirmReset = false; window.dispatchEvent(new Event('bt:rerender')); },
        async doReset() { ui.confirmReset = false; ui.copied = false; await services.calendar.reset(); toast('New link made. Subscribe again in Google Calendar.'); window.dispatchEvent(new Event('bt:rerender')); },
        ics() { downloadIcs(); },
        goal(el) {
            const year = todayIso().slice(0, 4);
            const cur = store.settings.goals?.[year] || 0;
            setGoal(year, Math.max(5, cur + Number(el.dataset.d) || 5));
        },
        goalOff() { setGoal(todayIso().slice(0, 4), null); },
        async importFile(el) {
            const file = el.files?.[0];
            if (!file) return;
            ui.importing = true; ui.result = null; ui.progress = null;
            window.dispatchEvent(new Event('bt:rerender'));
            try {
                const text = await file.text();
                ui.result = await importGoodreadsFile(text, { onProgress: (done, total) => { ui.progress = { done, total }; if (done % 5 === 0 || done === total) window.dispatchEvent(new Event('bt:rerender')); } });
                ui.picked = new Set(ui.result.suggestions.map((_, i) => i));
            } catch (e) {
                toast(e.message || 'That file could not be imported.');
            }
            ui.importing = false;
            window.dispatchEvent(new Event('bt:rerender'));
        },
        pick(el) { const i = Number(el.dataset.i); el.checked ? ui.picked.add(i) : ui.picked.delete(i); window.dispatchEvent(new Event('bt:rerender')); },
        async followPicked() { await followMany(ui.result.suggestions.filter((_, i) => ui.picked.has(i))); ui.result = { ...ui.result, suggestions: [] }; window.dispatchEvent(new Event('bt:rerender')); },
        csv() { exportCsv(); },
        json() { exportJson(); },
        theme(el) { store.saveSettings({ theme: el.dataset.v }); },
        async recheck() { await checkHardcover(); window.dispatchEvent(new Event('bt:rerender')); },
        async releases(el) {
            el.disabled = true;
            const r = await checkReleases({ force: true }).catch(() => null);
            toast(r?.skipped === 'unavailable' ? 'Hardcover isn’t connected yet, so releases can’t be checked.' : r?.added ? `${plural(r.added, 'new release')} found` : 'You’re up to date.');
            window.dispatchEvent(new Event('bt:rerender'));
        },
        async sample() { await seedSampleLibrary(); toast('Sample library loaded'); location.hash = '#/'; },
        previewReset() { ui.confirmPreviewReset = true; window.dispatchEvent(new Event('bt:rerender')); },
        cancelPreviewReset() { ui.confirmPreviewReset = false; window.dispatchEvent(new Event('bt:rerender')); },
        doPreviewReset() { services.resetPreview(); },
    },
};
