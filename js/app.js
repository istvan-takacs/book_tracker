// App shell: routing, rendering, sign-in and boot.

import { firebaseConfig, workerUrl } from '../config.js';
import { store, firestoreBackend, previewBackend } from './store.js';
import { services } from './services.js';
import { setIdTokenProvider, onSourceStatus } from './api.js';
import { checkReleases } from './releases.js';
import { closeSheet, toast } from './ui.js';
import home from './views/home.js';
import library from './views/library.js';
import search from './views/search.js';
import scan, { processScanQueue } from './views/scan.js';
import upcoming from './views/upcoming.js';
import stats from './views/stats.js';
import settings from './views/settings.js';
import onboarding from './views/onboarding.js';
import book from './views/book.js';
import author from './views/author.js';

const ROUTES = [
    [/^\/?$/, home],
    [/^\/library$/, library, () => ({ segment: 'shelves' })],
    [/^\/library\/(authors|series)$/, library, (m) => ({ segment: m[1] })],
    [/^\/search$/, search],
    [/^\/scan$/, scan],
    [/^\/upcoming$/, upcoming],
    [/^\/upcoming\/(calendar)$/, upcoming, (m) => ({ mode: m[1] })],
    [/^\/stats$/, stats],
    [/^\/settings(?:\/(\w+))?$/, settings, (m) => ({ section: m[1] || null })],
    [/^\/onboarding$/, onboarding],
    [/^\/book\/(.+)$/, book, (m) => ({ key: m[1] })],
    [/^\/author\/(hc_\d+)$/, author, (m) => ({ key: m[1] })],
    [/^\/author\/name\/(.+)$/, author, (m) => ({ name: m[1] })],
];

function resolve() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs = ''] = raw.split('?');
    for (const [re, view, params] of ROUTES) {
        const m = re.exec(path);
        if (m) return { view, params: params ? params(m) : {}, query: new URLSearchParams(qs), path, raw };
    }
    return { view: home, params: {}, query: new URLSearchParams(), path: '/', raw: '/' };
}

const root = document.getElementById('view');
const tabs = document.querySelector('.tabs');
let current = null;

function paint(route, { keepScroll = false } = {}) {
    const y = window.scrollY;
    root.innerHTML = route.view.render(route).toString();
    root.classList.toggle('immersive', !!route.view.immersive);
    tabs.hidden = !!route.view.hideTabs;
    tabs.querySelectorAll('a[data-tab]').forEach((a) => {
        if (a.dataset.tab === route.view.tab) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });
    if (keepScroll) window.scrollTo(0, y);
}

const rerender = () => {
    if (!current || current.view.manual) return;
    // don't clobber a field the reader is typing in
    const active = document.activeElement;
    if (active && root.contains(active) && active.matches('input:not([type=checkbox]):not([type=file]), textarea, select')) return;
    paint(current, { keepScroll: true });
};

async function navigate() {
    const route = resolve();
    if (store.loaded && !store.settings.onboardedAt && route.view !== onboarding) { location.replace('#/onboarding'); return; }
    if (current?.cleanup) { try { (await current.cleanup)?.(); } catch (e) { console.warn(e); } }
    closeSheet();
    current = route;
    paint(route);
    if (!route.view.immersive) window.scrollTo(0, 0);
    root.focus({ preventScroll: true });
    const result = route.view.mount?.(root, route, rerender);
    current.cleanup = result instanceof Promise ? result : Promise.resolve(result);
    document.title = route.view === home || !route.view.tab ? 'Book Tracker' : `${route.view.tab.replace(/^\w/, (c) => c.toUpperCase())} · Book Tracker`;
}

// One delegated listener for every view: elements with data-action call the
// current view's handler of that name.
for (const type of ['click', 'change']) {
    root.addEventListener(type, (e) => {
        const el = e.target.closest('[data-action]');
        if (!el || !current) return;
        const on = (el.dataset.on || 'click').split(' ');
        if (!on.includes(type)) return;
        const handler = current.view.handlers?.[el.dataset.action];
        if (!handler) return;
        if (type === 'click' && el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
        handler(el, e, current.view.context?.(current) || {});
    });
}

function applyTheme() {
    const t = store.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
}

function updateBadge() {
    const n = [...store.books.values()].filter((b) => b.isNew).length;
    const badge = tabs.querySelector('.tab-badge');
    badge.hidden = !n;
    badge.textContent = n ? String(n) : '';
    badge.setAttribute('aria-label', n ? `${n} new` : '');
}

let wasLoaded = false;
store.subscribe(() => {
    applyTheme();
    updateBadge();
    if (store.loaded && !wasLoaded) {
        wasLoaded = true;
        navigate();
        setTimeout(() => { checkReleases().catch(() => null); processScanQueue(); }, 1500);
        return;
    }
    if (store.loaded) rerender();
});
window.addEventListener('bt:rerender', () => { if (current) paint(current, { keepScroll: true }); });
window.addEventListener('hashchange', navigate);
window.addEventListener('online', () => { processScanQueue(); toast('Back online'); });
onSourceStatus(() => rerender());
store.onError((err) => toast(err?.code === 'permission-denied' ? 'That change wasn’t allowed. Try signing out and in again.' : 'A change couldn’t be saved. It will be retried when you’re back online.'));

// ─── Boot ───────────────────────────────────────────────────────────

function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(30));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function bootFirebase() {
    const { initFirebase } = await import('./firebase.js');
    const fb = await initFirebase(firebaseConfig);
    services.mode = 'firebase';
    services.signIn = () => fb.signIn();
    services.signOut = async () => { await fb.signOut(); location.hash = '#/onboarding'; location.reload(); };
    setIdTokenProvider(() => fb.idToken());
    const tokenDoc = (t) => fb.fs.doc(fb.db, 'calendarTokens', t);
    services.calendar = {
        available: !!workerUrl,
        feedUrl: () => (store.settings.calendarToken && workerUrl ? `${workerUrl.replace(/\/$/, '')}/cal/${store.settings.calendarToken}.ics` : null),
        async ensure() {
            if (store.settings.calendarToken) return store.settings.calendarToken;
            const token = randomToken();
            await fb.fs.setDoc(tokenDoc(token), { uid: services.user.uid, createdAt: new Date().toISOString() });
            await store.saveSettings({ calendarToken: token });
            return token;
        },
        async reset() {
            const old = store.settings.calendarToken;
            if (old) await fb.fs.deleteDoc(tokenDoc(old)).catch(() => null);
            await store.saveSettings({ calendarToken: null });
            return this.ensure();
        },
    };
    fb.onUser(async (user) => {
        services.user = user;
        if (user) {
            await store.attach(firestoreBackend({ db: fb.db, fs: fb.fs, uid: user.uid }));
            if (user.displayName && store.settings.displayName !== user.displayName) store.saveSettings({ displayName: user.displayName });
        } else {
            wasLoaded = false;
            store.loaded = false;
            current = null;
            location.replace('#/onboarding');
            paint(resolve());
        }
    });
}

async function bootPreview() {
    services.mode = 'preview';
    const backend = previewBackend();
    services.resetPreview = () => { backend.reset(); location.hash = '#/onboarding'; location.reload(); };
    await store.attach(backend);
}

(async () => {
    try {
        if (firebaseConfig.apiKey) await bootFirebase();
        else await bootPreview();
    } catch (e) {
        console.error('[boot]', e);
        root.innerHTML = '<div class="empty"><h1 class="title-md">Book Tracker couldn’t start</h1><p class="muted">Check your connection and reload. If this keeps happening, the setup in config.js may be incomplete.</p></div>';
    }
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
    }
})();
