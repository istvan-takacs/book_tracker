import { html, icon, cover, authorLinks, seriesLabel, fmtNumber, toast } from '../ui.js';
import { store } from '../store.js';
import { lookupIsbn } from '../api.js';
import { startScanner, queue } from '../scanner.js';
import { toIsbn13 } from '../lib/isbn.js';
import { normalize } from '../lib/text.js';
import { setShelf } from '../actions.js';
import { bookHref, libraryStatus, communityRating } from '../components.js';
import { openRateSheet } from '../sheets/rate.js';
import { openAddBookSheet } from '../sheets/releaseDate.js';

const s = { mode: 'starting', isbn: null, book: null, error: null, count: 0, torch: false, torchSupported: false, queued: [] };
let scanner = null;
let paint = () => {};

/** What this book means to you: the most useful single sentence. */
function context(book) {
    const status = libraryStatus(book);
    if (status) return status;
    if (book.series?.name) {
        const followed = [...store.series.values()].find((x) => x.followed && normalize(x.name) === normalize(book.series.name));
        const prev = [...store.books.values()].find((b) => normalize(b.series?.name) === normalize(book.series.name) && b.series.position === (book.series.position || 0) - 1);
        if (followed || prev) {
            return `This is book ${book.series.position} in ${followed ? 'a series you follow' : book.series.name}.${prev?.rating ? ` You gave book ${prev.series.position}, ${prev.title}, ${prev.rating} out of 10.` : ''}`;
        }
    }
    const author = book.authors?.[0];
    if (author) {
        const theirs = [...store.books.values()].filter((b) => b.status === 'read' && b.authors?.some((a) => normalize(a.name) === normalize(author.name)));
        if (theirs.length) {
            const rated = theirs.filter((b) => b.rating != null);
            const avg = rated.length ? Math.round((rated.reduce((x, b) => x + b.rating, 0) / rated.length) * 10) / 10 : null;
            return `You’ve read ${theirs.length} of ${author.name}’s books${avg != null ? `, with an average rating of ${avg} out of 10` : ''}.`;
        }
    }
    return null;
}

async function handleIsbn(isbn) {
    if (s.mode === 'looking') return;
    s.isbn = isbn;
    s.count++;
    if (!navigator.onLine) {
        await queue.add(isbn).catch(() => null);
        s.queued = await queue.list();
        s.mode = 'queued';
        paint();
        return;
    }
    s.mode = 'looking';
    paint();
    try {
        const book = await lookupIsbn(isbn);
        if (book) {
            s.book = book;
            s.mode = 'found';
        } else s.mode = 'notfound';
    } catch (e) {
        if (e.code === 'invalid_isbn') { s.mode = 'scanning'; toast('That barcode is not a book ISBN.'); }
        else { await queue.add(isbn, 'error').catch(() => null); s.queued = await queue.list(); s.mode = 'queued'; }
    }
    paint();
}

function panel() {
    const b = s.book;
    if (s.mode === 'error') {
        return html`<div class="scan-panel"><h2 class="title-md">Camera unavailable</h2><p class="prose">${s.error}</p>
            <p class="small muted">On iPhone: Settings → Safari → Camera → Allow, or allow it when the app asks. You can always type the ISBN instead.</p>${manualEntry()}</div>`;
    }
    if (s.mode === 'looking') return html`<div class="scan-panel" role="status"><span class="eyebrow">ISBN ${s.isbn}</span><p class="title-sm">Looking it up…</p><div class="skeleton" style="background:#2c3249"></div></div>`;
    if (s.mode === 'queued') {
        return html`<div class="scan-panel" role="status"><span class="eyebrow" style="color:var(--warn)">SAVED FOR LATER · ISBN ${s.isbn}</span>
            <h2 class="title-md">No connection right now</h2><p class="prose">This barcode is saved on your phone and will be looked up automatically when you’re back online. ${s.queued.length > 1 ? `${s.queued.length} scans are waiting.` : ''}</p>
            <button type="button" class="btn btn-primary btn-lg" data-action="again">Scan another book</button></div>`;
    }
    if (s.mode === 'notfound') {
        return html`<div class="scan-panel"><span class="eyebrow" style="color:var(--warn)">NO MATCH · ISBN ${s.isbn}</span>
            <h2 class="title-md">We couldn’t find this book</h2>
            <p class="prose">Hardcover, Google Books and Open Library don’t know this ISBN yet. It might be very new, a special edition, or the number may have been misread.</p>
            <button type="button" class="btn btn-primary btn-lg" data-action="again">Try scanning again</button>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><a class="btn" href="#/search">Search by title</a><button type="button" class="btn" data-action="manualAdd">Add it manually</button></div>
            <button type="button" class="btn" data-action="later">Save to look up later</button>
            <span class="small muted">Saved numbers are checked again each time you open the app.</span></div>`;
    }
    if (s.mode === 'found' && b) {
        const inLib = store.get('books', b.key);
        const note = context(b);
        const cr = communityRating(b);
        return html`<section class="scan-panel" aria-label="Scanned book">
            <div class="row" style="align-items:flex-start;gap:14px">
                <a href="${bookHref(b)}" aria-label="Open full details for ${b.title}">${cover(b, { size: 'md', label: false })}</a>
                <div class="grow stack-sm" style="gap:4px"><span class="small strong sage">FOUND · ISBN ${s.isbn}</span>
                    <span class="title-md">${b.title}</span><span>${authorLinks(b.authors)}</span>
                    <span class="small muted">${[seriesLabel(b.series), b.pageCount && `${b.pageCount} pages`, b.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ')}</span>
                    ${cr != null && b.ratingsCount ? html`<span class="small muted">${Number(cr).toFixed(1)} out of 5 from ${fmtNumber(b.ratingsCount)} Hardcover readers</span>` : ''}</div></div>
            ${note ? html`<div class="banner banner-sage">${icon('check', 20)}<span class="strong">${note}</span></div>` : ''}
            ${b.description ? html`<p class="small" style="line-height:1.5;color:#d6d9e3">${b.description.length > 260 ? b.description.slice(0, 240).replace(/\s+\S*$/, '') + '…' : b.description}</p>` : ''}
            ${b.communityMoods?.length ? html`<div class="chips">${b.communityMoods.slice(0, 4).map((m) => html`<span class="tag">${m.toLowerCase()}</span>`)}</div>` : ''}
            ${inLib ? html`<a class="btn btn-primary btn-lg" href="${bookHref(b)}">Open in your library</a>`
                : html`<button type="button" class="btn btn-primary btn-lg" data-action="tbr">Add to TBR</button>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button type="button" class="btn" data-action="start">Start reading</button><button type="button" class="btn" data-action="readIt">I’ve read it</button></div>`}
            <div class="row-between"><a class="btn-link" href="${bookHref(b)}">See full details</a><button type="button" class="btn-link" data-action="again">Scan another book</button></div>
        </section>`;
    }
    return html`<div class="scan-panel">
        ${manualEntry()}
        <span class="small muted">No signal in the shop? Scans are saved on your phone and looked up when you’re back online.</span></div>`;
}

function manualEntry() {
    return html`<form class="stack-sm" data-manual><label class="field"><span class="eyebrow">Barcode won’t scan? Type the ISBN</span>
        <span class="row"><input class="input grow" inputmode="numeric" autocomplete="off" placeholder="978…" name="isbn" maxlength="17"><button class="btn btn-primary">Look up</button></span></label></form>`;
}

export default {
    tab: 'search',
    immersive: true,
    manual: true,
    hideTabs: true,
    render() {
        return html`<div class="scan">
            <video aria-label="Camera view" playsinline muted></video>
            <div class="scan-frame" data-frame aria-hidden="true"></div>
            <div class="scan-top"><a class="scan-pill" href="#" data-action="done">Done</a><span class="scan-pill small" data-count role="status"></span>
                <button type="button" class="scan-pill" style="width:44px;padding:0;justify-content:center" data-action="torch" aria-label="Turn torch on" aria-pressed="false" hidden>${icon('torch', 20)}</button></div>
            <p class="scan-hint" data-hint role="status">Starting the camera…</p>
            <div data-panel></div>
        </div>`;
    },
    async mount(root) {
        Object.assign(s, { mode: 'starting', book: null, isbn: null, error: null, count: 0 });
        const video = root.querySelector('video');
        const panelEl = root.querySelector('[data-panel]');
        paint = () => {
            if (!panelEl.isConnected) return;
            panelEl.innerHTML = panel().toString();
            root.querySelector('[data-count]').textContent = `${s.count} scanned this visit`;
            root.querySelector('[data-hint]').textContent = { starting: 'Starting the camera…', scanning: 'Point your camera at the barcode on the back cover', looking: 'Barcode read', found: 'Book found', notfound: 'No match for that barcode', queued: 'Saved for later', error: '' }[s.mode];
            root.querySelector('[data-frame]').style.setProperty('--frame', s.mode === 'found' ? '#8cc497' : s.mode === 'notfound' ? '#f0b86a' : '#eef0f6');
            const torch = root.querySelector('[data-action="torch"]');
            torch.hidden = !s.torchSupported;
            torch.setAttribute('aria-pressed', String(s.torch));
            torch.setAttribute('aria-label', s.torch ? 'Turn torch off' : 'Turn torch on');
        };
        root.addEventListener('submit', (e) => {
            if (!e.target.matches('[data-manual]')) return;
            e.preventDefault();
            const isbn = toIsbn13(e.target.isbn.value);
            if (!isbn) { toast('That doesn’t look like a valid ISBN. Check the 10 or 13 digits.'); return; }
            handleIsbn(isbn);
        });
        paint();
        try {
            scanner = await startScanner(video, { onIsbn: (isbn) => { if (['scanning', 'starting'].includes(s.mode)) handleIsbn(isbn); } });
            s.torchSupported = scanner.torchSupported;
            if (s.mode === 'starting') s.mode = 'scanning';
        } catch (e) {
            s.mode = 'error';
            s.error = e.name === 'NotAllowedError' ? 'Camera access was not allowed.' : e.message || 'The camera could not be started.';
        }
        paint();
        return () => { scanner?.stop(); scanner = null; s.torch = false; paint = () => {}; };
    },
    handlers: {
        done() { scanner?.stop(); history.length > 1 ? history.back() : (location.hash = '#/search'); },
        async torch() { s.torch = !s.torch; await scanner?.setTorch(s.torch).catch(() => null); paint(); },
        again() { s.mode = 'scanning'; s.book = null; paint(); },
        async tbr() { await setShelf(s.book, 'want'); paint(); },
        async start() { await setShelf(s.book, 'reading'); paint(); },
        readIt() { openRateSheet(s.book); },
        manualAdd() { openAddBookSheet({ isbn: s.isbn }); },
        async later() { await queue.add(s.isbn, 'notfound').catch(() => null); toast('Saved. It will be checked again next time you open the app.'); s.mode = 'scanning'; paint(); },
    },
};

/** Look up queued scans (called on app start and when coming back online). */
export async function processScanQueue() {
    if (!navigator.onLine) return;
    const items = await queue.list();
    for (const item of items) {
        try {
            const book = await lookupIsbn(item.isbn);
            if (book) {
                if (!store.get('books', book.key)) await setShelf(book, 'want', { quiet: true });
                await queue.remove(item.isbn);
                toast(`Found a saved scan: ${book.title} is now on your TBR`);
            }
        } catch { /* try again next time */ }
    }
}
