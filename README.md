# Book Tracker

A personal reading tracker and release radar. It's a phone-first PWA built for iPhone that also works on desktop.

- **Track your reading:** TBR, Reading, Read and DNF shelves; progress by page, percent or audiobook time; ratings out of 10; reviews; re-reads; hybrid formats (print, ebook and audio in any combination); moods and a few "how did it feel" scales; a yearly goal; stats; Goodreads import; CSV and JSON export.
- **Release radar:** rating a book 6 or higher follows its author and series. Their upcoming books appear in Upcoming (as a timeline or calendar) and in a Google Calendar you subscribe to once. You can set release dates yourself when you find one online.
- **Search and scan:** typo-tolerant search across authors, titles and series, plus barcode scanning in bookshops. Scans work offline and are looked up later.

The stack is vanilla HTML/CSS/JS ES modules with no build step, Firebase (Google sign-in plus Firestore with an offline cache), a Cloudflare Worker that keeps the Hardcover token secret and serves the calendar feed, and Google Books and Open Library as fallbacks.

## Try it now (preview mode)

```bash
python3 -m http.server 8000     # or: npm run serve
```

Open http://localhost:8000. With an empty `config.js`, the app runs in **preview mode**: data stays in this browser and search uses Google Books and Open Library. On the first-time setup screen, "Or try it with a sample library" fills every screen with fictional books.

Without a Google Books key you share Google's anonymous daily quota, which runs out quickly. When it does, search shows a notice and only searches your library.

## Setup

### 1. Firebase (sign-in and sync)
1. Create a project at https://console.firebase.google.com.
2. **Authentication → Sign-in method → Google:** enable it. Under Authentication → Settings → Authorized domains, add `localhost` and `<you>.github.io`.
3. **Firestore Database:** create it (production mode), then paste [`firestore.rules`](firestore.rules) into the Rules tab and publish.
4. **Project settings → Your apps → Web app:** copy the config into `firebaseConfig` in [`config.js`](config.js).

### 2. Google Books key (recommended)
In Google Cloud console (same project): enable the **Books API**, create an API key, and restrict it by **HTTP referrer** to `https://<you>.github.io/*` and `http://localhost:8000/*`. Put it in `googleBooksKey`.

### 3. Hardcover and the Worker
1. On Hardcover: Settings → Hardcover API → **New API key**. Give it **read-only scopes** and note the expiry date.
2. Install Wrangler (`npm i -g wrangler`), then run `wrangler login`.
3. In [`worker/wrangler.toml`](worker/wrangler.toml), set `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS` and `APP_URL`.
4. From `worker/`:
   ```bash
   wrangler secret put HARDCOVER_TOKEN      # the read-only token
   wrangler secret put ALLOWED_UIDS         # your Firebase user ID (Firebase console → Authentication → Users)
   wrangler deploy
   ```
5. Put the Worker URL (`https://book-tracker.<you>.workers.dev`) in `workerUrl` in `config.js`.

The Worker only runs the read-only queries listed in `worker/src/queries.js`. It checks your Firebase sign-in on every request and only accepts the user IDs in `ALLOWED_UIDS`. When the Hardcover token expires, Settings → Book data sources shows "Needs a new access token". Make a new token and run `wrangler secret put HARDCOVER_TOKEN` again.

### 4. Calendar feed (optional, recommended)
The subscribed calendar is served by the Worker, which reads your upcoming books with a service account:
1. Firebase console → Project settings → Service accounts → **Generate new private key**. Never commit this file.
2. From `worker/`, run `wrangler secret put FIREBASE_SA_EMAIL` (the `client_email`) and `wrangler secret put FIREBASE_SA_KEY` (the `private_key`, including the BEGIN and END lines). Then run `wrangler deploy`.
3. In the app: Settings → Calendar sync → **Create my calendar link** → **Add to Google Calendar**.

Google refreshes subscribed calendars roughly every 12–24 hours.

### 5. Deploy
Push to GitHub and enable **Pages** (main branch, root). Set `appUrl` in `config.js` to the Pages URL. On iPhone, open the site in Safari → Share → **Add to Home Screen**.

When you change the app shell, bump `VERSION` in [`sw.js`](sw.js).

## Development

```bash
npm test                         # node --test, pure modules + Worker (Node 20+, no installs)
node --test tests/search.test.js # one file
cd worker && wrangler dev        # Worker on http://localhost:8787 (secrets in worker/.dev.vars)
```

`python3 -m http.server` lets the browser cache ES modules, so after editing a file, hard-reload (Cmd+Shift+R).

## Data

Everything lives under `users/{uid}/` in Firestore: `books/{key}` (`hc_<id>`, `gb_<volumeId>`, `isbn_<isbn>` or `manual_…`), `authors/{key}`, `series/{key}` and `meta/settings`. `calendarTokens/{token}` maps the private feed link to your user ID; only the Worker can read it. See [`docs/hardcover-fields.md`](docs/hardcover-fields.md) for which Hardcover fields the app uses and what still needs checking against the live API.

Book data comes from [Hardcover](https://hardcover.app), [Google Books](https://books.google.com) and [Open Library](https://openlibrary.org).
