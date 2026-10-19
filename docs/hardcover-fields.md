# Hardcover data check (plan step 0b)

This was checked on 2026-10-19 against the Hardcover docs source (github.com/hardcoverapp/hardcover-docs), because docs.hardcover.app blocks automated fetches. **Nothing has been run against the live API yet.** Once a token exists, re-run the queries in `worker/src/queries.js` in the GraphQL console (`https://api.hardcover.app/v1/graphql`) and tick the last column.

## API facts that shape the design

- Endpoint: `POST https://api.hardcover.app/v1/graphql`, with the header `authorization: Bearer <token>`.
- **"Queries are not allowed to run in the browser, they must be run in an environment where the token can be kept secure."** This confirms the Cloudflare Worker proxy.
- Personal access tokens now have **scopes** and an **expiry date**. Create a read-only token and note when it expires. The Settings screen shows an expired token as "needs a new access token".
- Free plan limits: **5,000 requests a day, 60 a minute, burst of 10**. Each *top-level field* in a query counts as one request, so each Worker operation uses exactly one top-level field.
- Queries time out after 30 s, and search after **2 s**.
- `_like`, `_ilike`, `_regex` and similar operators are disabled, so all text matching must go through `search`.
- Personal use of your own data is fine. Aggregate data (ratings, reader counts) must be labelled as Hardcover data, which the UI already does.

## Fields the UI relies on

| UI element | Source | Found in docs | Verified live |
|---|---|---|---|
| Typo-tolerant search for books, authors and series | `search(query, query_type: "book"\|"author"\|"series", per_page, page) { results }`, backed by Typesense with per-field `typos` | yes | ☐ |
| Book search hit: title, authors, series and position, ISBNs, cover, rating, ratings count, readers, moods, genres, content warnings, pages, audio length | `results.hits[].document`: `title, author_names, featured_series, featured_series_position, series_names, isbns, image, rating, ratings_count, users_count, users_read_count, moods (top 5), genres (top 5), content_warnings (top 5), pages, audio_seconds, release_year, release_date_i, description, slug` | yes | ☐ |
| Author search hit | `name, alternate_names, books_count, series_names, books (top 5 titles), image, slug` | yes | ☐ |
| Series search hit | `name, author_name, author, books_count, primary_books_count, books, readers_count, slug` | yes | ☐ |
| Release date and precision | `books.release_date` (date), `books.release_year` (int). The docs **don't say how unknown days are stored**. Heuristic: a null date with a year means year precision; a future 1 January or 31 December date is treated as year precision until checked live. | partly | ☐ |
| Series, position and reading order | `book_series { position details featured compilation series { id name books_count primary_books_count is_completed } }`. To de-duplicate: `distinct_on: position`, order by position, then `book.users_count desc`, with `canonical_id is null`, `is_partial_book = false` and `compilation = false` | yes | ☐ |
| Author page: bio, books | `authors { id name bio born_year location links cached_image books_count contributions { contribution book { … } } }` | yes | ☐ |
| Narrator, audiobook length | `books.audio_seconds`, `default_audio_edition { audio_seconds contributions { contribution author { name } } }`. The contribution role is `"Narrator"` | yes | ☐ |
| Editions and formats | `editions { edition_format reading_format_id pages release_date isbn_10 isbn_13 audio_seconds publisher { name } }` | yes | ☐ |
| Barcode lookup | `editions(where: { isbn_13: { _eq } })`, with an `isbn_10` fallback | yes | ☐ |
| Publisher, first published | `default_physical_edition { publisher { name } release_date }`, `books.release_date` | yes | ☐ |
| Community moods, genres, content warnings | the search document's `moods` / `genres` / `content_warnings` (top 5 each), plus `books.cached_tags` (jsonb, format undocumented) | yes | ☐ |
| Community rating | `books.rating` (0–5), `ratings_count`, `ratings_distribution` | yes | ☐ |
| "More like this" candidates | `books.cached_similar_book_ids` (about 100, ordered) | yes | ☐ |

## What changes as a result

1. **Pace, Tone and "Driven by" have no community data.** Hardcover has no StoryGraph-style scales; the "vibes" feature is a recommendation feed, not book attributes. So **"What readers say it feels like" shows only community moods**, and the three scales come only from your own reads (stats, filters, "More like this").
2. **Mood percentages are cut.** The search document gives the *top 5* moods without counts, and `cached_tags` has no documented format. The book page lists the moods in order, without percentages. If `cached_tags` turns out to include counts, it will show "tagged by N readers" instead.
3. **Release-day precision needs live checking.** The precision heuristic sits in `js/lib/dates.js` behind one function, so it's easy to correct.
4. **"More like this"** ranks Hardcover's `cached_similar_book_ids` against your own moods, scales and ratings, instead of only looking in your library.
