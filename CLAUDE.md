# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                              # all tests: node --test "tests/**/*.test.js" (Node 20+, no dependencies)
node --test tests/search.test.js      # a single test file
node --test --test-name-pattern="typo" tests/search.test.js   # a single test
python3 -m http.server 8000           # serve the app (no build step)
cd worker && wrangler dev             # run the Worker locally (secrets in worker/.dev.vars)
cd worker && wrangler deploy
```

`python3 -m http.server` lets browsers cache ES modules, so hard-reload after edits. If one module's export seems to be missing in the browser, it is usually a stale cached file.

## Architecture

A vanilla JS PWA (ES modules loaded straight from the browser, no bundler) plus a Cloudflare Worker.

- **Data sources (`js/api.js`).** Hardcover is the source of truth, but it is only reachable through the Worker, because Hardcover forbids browser calls and the token must stay secret. Google Books, then Open Library, only fill gaps. The rules are in `js/lib/merge.js`: Hardcover wins, with one exception. A more precise secondary date for the same book can upgrade a year- or month-only Hardcover date. `sourceStatus` tracks Hardcover health (`ok`, `token`, `down`, `limited`, `offline`, `unconfigured`), and views show `hardcoverBanner()` instead of failing silently.
- **Pure logic in `js/lib/`.** These modules have no DOM or network access, and every one of them has tests: `text` (fuzzy matching), `search` (ranking), `merge`, `normalize` (source JSON → BookMeta), `dates` (precision, labels, timeline buckets), `stats`, `goodreads` (CSV import), `calendar` (Google Calendar links and ICS), `follow`, `progress`, `isbn`. The Worker imports `js/lib/calendar.js` and `js/lib/dates.js` directly, and wrangler bundles them.
- **Store (`js/store.js`).** In-memory Maps (`books`, `authors`, `series`) plus `settings`, with two interchangeable backends. Firestore (`users/{uid}/…`, with a persistent offline cache) is used when `config.js` has a Firebase config. Otherwise the localStorage "preview mode" backend is used. Writes apply locally first, then persist. `store.put` replaces a document, which is how Undo works.
- **Actions (`js/actions.js`).** Every user-facing mutation lives here (shelving, progress, `finishBook`, follows, manual dates, Goodreads import and export). Mutations a reader might regret show a toast with Undo. `metaOf()` stores source metadata, and a source's `rating` (out of 5) is stored as `communityRating`, because `rating` on a library book is the reader's 1–10 rating.
- **Views (`js/views/*.js`).** Each exports `{ tab, render(route) → html, mount?(root, route, rerender) → cleanup, handlers, context?, manual?, immersive?, hideTabs? }`. `js/app.js` routes by hash, re-renders the current view on store changes (unless `manual`, as in Search and Scan, which update their own result areas), and uses one delegated listener to dispatch `data-action="name"` to `handlers[name](el, event, context)`. `data-on="change"` switches the event type. Views call `window.dispatchEvent(new Event('bt:rerender'))` for local UI state.
- **Templating (`js/ui.js`).** The `html` tagged template escapes every interpolation. Only `raw()` bypasses escaping, so never pass user or source text to `raw()`. Booleans in attributes must be passed through `String()`, because `false` renders as empty.
- **Sheets (`js/sheets/`).** Bottom sheets on phones and side panels from 900 px: progress (page, percent or audio time, stored as a fraction), finish-and-rate (short by default, "Add details" expands), release date or manual book.
- **Worker (`worker/src/`).** `POST /q/:op` runs only the queries in `queries.js`, with validated variables and one top-level field each, because Hardcover rate-limits per top-level field. Each request needs a Firebase ID token (checked in `firebaseAuth.js` against Google's JWKs) whose `sub` is in `ALLOWED_UIDS`. Responses are cached per operation and variables. `GET /cal/:token.ics` serves the subscribed calendar by reading Firestore over REST with a service account (`firestore.js`).
- **Release radar (`js/releases.js`).** At most once a day (or on demand), it queries followed authors and series and writes new books as `status: 'upcoming'` with `isNew`. It also records Hardcover date changes, and if they conflict with the reader's `releaseDateOverride`, it sets `pendingDate` so the book page can ask.

## Conventions

- UI copy uses no abbreviations ("page", "average", "book 3", full month and day names). The exceptions are **TBR** and **DNF**, which the user prefers. Every number in the UI says what it measures.
- Phone first (iPhone 16 Pro, 402 pt): 44 px or larger touch targets, safe-area insets, inputs at 16 px or more so iOS doesn't zoom, and primary actions in the lower half. The desktop layout (900 px and up) is a sidebar plus a centred column.
- Colours are CSS tokens in `style.css` (light, dark, or forced via `[data-theme]`).
- Hardcover's schema is in beta. Field assumptions are listed in `docs/hardcover-fields.md`. Update that file when you verify or change a query.
- When adding shell files, list them in `SHELL_FILES` in `sw.js` and bump `VERSION`.
