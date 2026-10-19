import { html, raw, plural, toast } from '../ui.js';
import { store } from '../store.js';
import { services } from '../services.js';
import { importGoodreadsFile, followMany } from '../actions.js';
import { computeStats } from '../lib/stats.js';
import { todayIso } from '../lib/dates.js';
import { seedSampleLibrary } from '../sample.js';

const st = { step: 1, importing: false, progress: null, result: null, goal: 24, error: null };

const GOOGLE_LOGO = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';

export function startOnboardingAt(step) { st.step = step; }

export default {
    tab: null,
    hideTabs: true,
    render() {
        const signedIn = services.mode === 'preview' || !!services.user;
        const step = signedIn ? Math.max(2, st.step) : 1;
        const year = todayIso().slice(0, 4);
        const readSoFar = computeStats([...store.books.values()], { year }).books;
        const r = st.result;
        const daysLeft = Math.max(1, Math.round((Date.UTC(Number(year) + 1, 0, 1) - Date.now()) / 86400000));
        return html`<div class="stack" style="min-height:calc(100dvh - var(--safe-top) - 60px)">
            <div class="row-between"><span class="small strong muted" role="status">Step ${step} of 3</span>
                ${step > 2 ? html`<button type="button" class="btn-link" data-action="back">Back</button>` : ''}</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px" aria-hidden="true">${[1, 2, 3].map((n) => html`<span style="height:5px;border-radius:3px;background:${n <= step ? 'var(--accent)' : 'var(--surface-2)'}"></span>`)}</div>

            ${step === 1 ? html`
                <h1 class="title" style="font-size:34px;margin-top:20px">Your reading, and what’s coming next</h1>
                <p class="prose muted" style="font-size:16px">Track what you read, rate it out of 10, and see every new release from the authors and series you love in one timeline.</p>
                <div class="card stack-sm"><span class="strong">Why sign in?</span><span class="small muted">Your library is saved to your Google account, so it’s safe if Safari clears website data, and it’s the same on your phone and computer.</span></div>
                ${st.error ? html`<p class="banner banner-warn" role="alert"><span class="dot"></span><span>${st.error}</span></p>` : ''}
                <span class="grow"></span>
                <button type="button" class="btn btn-lg btn-block" style="background:#fff;color:#1f1f1f;border-color:var(--line)" data-action="google">${raw(GOOGLE_LOGO)}Continue with Google</button>` : ''}

            ${step === 2 ? html`
                <h1 class="title" style="margin-top:20px">Bring your books from Goodreads</h1>
                <p class="prose muted" style="font-size:16px">Your shelves, ratings and read dates come across. Goodreads ratings out of 5 are doubled to fit the 10-point scale.</p>
                <ol class="card small" style="margin:0;padding:16px 16px 16px 36px;line-height:1.6"><li>On Goodreads, open <strong>My Books → Import and export</strong>.</li><li>Tap <strong>Export library</strong> and download the file.</li><li>Choose that file below.</li></ol>
                ${st.importing ? html`<div class="card stack-sm" role="status"><span class="strong">Matching your books… ${st.progress ? `${st.progress.done} of ${st.progress.total}` : ''}</span><div class="progress-bar"><span style="width:${st.progress ? Math.round((st.progress.done / st.progress.total) * 100) : 5}%"></span></div></div>`
                    : r ? html`<div class="banner banner-sage" role="status" style="flex-direction:column"><span class="strong">Imported ${plural(r.summary.total, 'book')}</span><span>${r.summary.read} read, ${r.summary.want} on your TBR, ${r.summary.dnf} DNF.${r.suggestions.length ? ` ${plural(r.suggestions.length, 'author')} you rated highly will be followed.` : ''}</span></div>`
                    : html`<label class="btn btn-lg btn-block" style="border-style:dashed;border-color:var(--accent);color:var(--accent);background:var(--accent-soft);cursor:pointer">Choose your Goodreads file<input type="file" accept=".csv,text/csv" class="visually-hidden" data-action="file" data-on="change"></label>`}
                ${services.mode === 'preview' && !r ? html`<button type="button" class="btn-link" data-action="sample">Or try it with a sample library</button>` : ''}
                <span class="grow"></span>
                <button type="button" class="btn btn-primary btn-lg btn-block" data-action="next" ${st.importing ? raw('disabled') : ''}>${r ? 'Continue' : 'Skip for now'}</button>
                <span class="small muted" style="text-align:center">You can import later from Settings.</span>` : ''}

            ${step === 3 ? html`
                <h1 class="title" style="margin-top:20px">Set a reading goal for ${year}?</h1>
                <p class="prose muted" style="font-size:16px">Home shows how you’re doing and whether you’re ahead of schedule. You’ve read ${plural(readSoFar, 'book')} so far this year.</p>
                <div class="card stepper"><button type="button" class="btn btn-icon" aria-label="Five fewer books" data-action="goal" data-d="-5">−</button>
                    <div style="text-align:center"><div class="big-value">${st.goal}</div><div class="muted">books in ${year}</div></div>
                    <button type="button" class="btn btn-icon" aria-label="Five more books" data-action="goal" data-d="5">+</button></div>
                <span class="small muted">${readSoFar >= st.goal ? 'You’ve already reached this. Maybe aim higher?' : `That’s ${plural(st.goal - readSoFar, 'more book')} in the ${Math.ceil(daysLeft / 7)} weeks left this year.`}</span>
                <span class="grow"></span>
                <button type="button" class="btn btn-primary btn-lg btn-block" data-action="finish">Set goal and start</button>
                <button type="button" class="btn-link" style="align-self:center" data-action="skipGoal">Skip, no goal for now</button>` : ''}
        </div>`;
    },
    handlers: {
        async google() {
            st.error = null;
            try { await services.signIn(); st.step = 2; } catch (e) { st.error = e.code === 'auth/popup-closed-by-user' ? 'Sign-in was cancelled. Try again when you’re ready.' : 'Sign-in didn’t work. Check your connection and try again.'; }
            window.dispatchEvent(new Event('bt:rerender'));
        },
        back() { st.step = Math.max(2, st.step - 1); window.dispatchEvent(new Event('bt:rerender')); },
        next() { st.step = 3; window.dispatchEvent(new Event('bt:rerender')); },
        async sample() { await seedSampleLibrary(); location.hash = '#/'; },
        async file(el) {
            const f = el.files?.[0];
            if (!f) return;
            st.importing = true;
            window.dispatchEvent(new Event('bt:rerender'));
            try {
                st.result = await importGoodreadsFile(await f.text(), { onProgress: (done, total) => { st.progress = { done, total }; if (done % 5 === 0 || done === total) window.dispatchEvent(new Event('bt:rerender')); } });
                if (st.result.suggestions.length) await followMany(st.result.suggestions);
            } catch (e) { toast(e.message || 'That file could not be imported.'); }
            st.importing = false;
            window.dispatchEvent(new Event('bt:rerender'));
        },
        goal(el) { st.goal = Math.max(5, st.goal + Number(el.dataset.d)); window.dispatchEvent(new Event('bt:rerender')); },
        async finish() { await store.saveSettings({ goals: { [todayIso().slice(0, 4)]: st.goal }, onboardedAt: new Date().toISOString() }); location.hash = '#/'; },
        async skipGoal() { await store.saveSettings({ onboardedAt: new Date().toISOString() }); location.hash = '#/'; },
    },
};

