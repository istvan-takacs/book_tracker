// Convert each source's raw response into one book shape (BookMeta) that
// merge.js and the UI understand. Defensive on purpose: Hardcover's search
// documents are Typesense JSON whose nested shapes are not fully documented.

import { precisionOf, fromGooglePublished, toIso } from './dates.js';
import { toIsbn13, clean } from './isbn.js';

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const imageUrl = (img) => str(typeof img === 'string' ? img : img?.url);
const tagNames = (list) => arr(list).map((t) => (typeof t === 'string' ? t : t?.tag || t?.name)).filter(Boolean);

/** Hardcover `release_date_i`: YYYYMMDD or unix seconds, depending on the index. */
function dateFromInt(i) {
    const n = num(i);
    if (!n) return null;
    if (n > 10000101 && n < 30001231) {
        const s = String(Math.trunc(n));
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    if (n > 1e9) return toIso(n * 1000);
    return null;
}

function hcAuthors(contribs, names) {
    const fromContribs = arr(contribs)
        .filter((c) => !c?.contribution || /^author$/i.test(c.contribution))
        .map((c) => ({ id: c?.author?.id ?? null, name: str(c?.author?.name) }))
        .filter((a) => a.name);
    if (fromContribs.length) return fromContribs;
    return arr(names).map((n) => ({ id: null, name: n }));
}

/** A Typesense hit document from `search(query_type: "book")`. */
export function fromHardcoverHit(doc) {
    if (!doc) return null;
    const fs = doc.featured_series;
    const seriesName = str(fs?.series?.name) || str(fs?.name) || str(arr(doc.series_names)[0]);
    const seriesId = fs?.series?.id ?? fs?.series_id ?? fs?.id ?? null;
    const position = num(doc.featured_series_position ?? fs?.position);
    const rel = precisionOf({ date: dateFromInt(doc.release_date_i), year: num(doc.release_year) });
    const isbns = arr(doc.isbns).map(toIsbn13).filter(Boolean);
    return {
        hardcoverId: num(doc.id),
        slug: str(doc.slug),
        title: str(doc.title),
        subtitle: str(doc.subtitle),
        authors: hcAuthors(doc.contributions, doc.author_names),
        series: seriesName ? { id: num(seriesId), name: seriesName, position } : null,
        releaseDate: rel.date,
        datePrecision: rel.precision,
        isbn13: isbns[0] || null,
        isbns,
        coverUrl: imageUrl(doc.image),
        description: str(doc.description),
        pageCount: num(doc.pages),
        audioSeconds: num(doc.audio_seconds),
        genres: tagNames(doc.genres),
        communityMoods: tagNames(doc.moods),
        contentWarnings: tagNames(doc.content_warnings),
        rating: num(doc.rating),
        ratingsCount: num(doc.ratings_count),
        readersCount: num(doc.users_count),
        compilation: !!doc.compilation,
    };
}

/** A `books` row from the GraphQL API (bookById / authorBooks / seriesBooks). */
export function fromHardcoverBook(b) {
    if (!b) return null;
    const featured = arr(b.book_series).find((s) => s.featured) || arr(b.book_series)[0];
    const rel = precisionOf({ date: b.release_date, year: num(b.release_year) });
    const phys = b.default_physical_edition || {};
    const audio = b.default_audio_edition || {};
    const narrator = arr(audio.contributions).find((c) => /narrator/i.test(c?.contribution || ''))?.author?.name || null;
    const editions = arr(b.editions).map((e) => ({
        id: num(e.id),
        format: str(e.edition_format) || ({ 1: 'Physical', 2: 'Audiobook', 3: 'Physical and audio', 4: 'Ebook' })[e.reading_format_id] || null,
        pages: num(e.pages),
        releaseDate: str(e.release_date),
        isbn13: toIsbn13(e.isbn_13) || toIsbn13(e.isbn_10),
        audioSeconds: num(e.audio_seconds),
        publisher: str(e.publisher?.name),
    }));
    const tags = b.cached_tags || {};
    const tagList = (key) => tagNames(tags[key] || tags[key.toLowerCase()]);
    return {
        hardcoverId: num(b.id),
        slug: str(b.slug),
        title: str(b.title),
        subtitle: str(b.subtitle),
        authors: hcAuthors(b.contributions, []),
        series: featured?.series ? { id: num(featured.series.id), name: str(featured.series.name), position: num(featured.position), total: num(featured.series.primary_books_count ?? featured.series.books_count) } : null,
        releaseDate: rel.date,
        datePrecision: rel.precision,
        isbn13: toIsbn13(phys.isbn_13) || editions.find((e) => e.isbn13)?.isbn13 || null,
        coverUrl: imageUrl(b.cached_image) || imageUrl(b.image),
        description: str(b.description),
        pageCount: num(b.pages) ?? num(phys.pages),
        audioSeconds: num(b.audio_seconds) ?? num(audio.audio_seconds),
        narrator,
        publisher: str(phys.publisher?.name),
        firstPublished: str(b.release_date),
        genres: tagList('Genre'),
        communityMoods: tagList('Mood'),
        contentWarnings: tagList('Content Warning'),
        rating: num(b.rating),
        ratingsCount: num(b.ratings_count),
        readersCount: num(b.users_count),
        editions,
        similarIds: arr(b.cached_similar_book_ids).map(num).filter(Boolean).slice(0, 30),
        compilation: !!b.compilation,
    };
}

/** A Google Books `volumes` item. */
export function fromGoogleVolume(v) {
    const info = v?.volumeInfo;
    if (!info) return null;
    const ids = arr(info.industryIdentifiers);
    const isbn13 = toIsbn13(ids.find((i) => i.type === 'ISBN_13')?.identifier) || toIsbn13(ids.find((i) => i.type === 'ISBN_10')?.identifier);
    const rel = fromGooglePublished(info.publishedDate);
    const cover = str(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail);
    const series = info.seriesInfo?.volumeSeries?.[0];
    return {
        googleVolumeId: str(v.id),
        title: str(info.title),
        subtitle: str(info.subtitle),
        authors: arr(info.authors).map((name) => ({ id: null, name })),
        series: series ? { id: null, name: null, position: num(series.orderNumber) } : null,
        releaseDate: rel.date,
        datePrecision: rel.precision,
        isbn13,
        coverUrl: cover ? cover.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
        description: str(info.description)?.replace(/<[^>]+>/g, '') ?? null,
        pageCount: num(info.pageCount),
        publisher: str(info.publisher),
        genres: arr(info.categories),
        language: str(info.language),
    };
}

/** Open Library `/isbn/{isbn}.json` edition plus the covers API. */
export function fromOpenLibraryEdition(e, isbn) {
    if (!e) return null;
    const isbn13 = toIsbn13(arr(e.isbn_13)[0]) || toIsbn13(arr(e.isbn_10)[0]) || toIsbn13(isbn);
    const desc = typeof e.description === 'string' ? e.description : e.description?.value;
    return {
        title: str(e.title),
        subtitle: str(e.subtitle),
        authors: [],
        isbn13,
        coverUrl: arr(e.covers).length ? `https://covers.openlibrary.org/b/id/${e.covers[0]}-L.jpg` : null,
        description: str(desc),
        pageCount: num(e.number_of_pages),
        publisher: str(arr(e.publishers)[0]),
        ...fromGooglePublishedLoose(e.publish_date),
    };
}

/** Open Library publish_date is free text ("March 14, 2027", "2027"). */
function fromGooglePublishedLoose(text) {
    if (!text) return { releaseDate: null, datePrecision: 'none' };
    const t = Date.parse(text + ' UTC');
    if (/\d{1,2},?\s+\d{4}/.test(text) && !Number.isNaN(t)) return { releaseDate: toIso(t), datePrecision: 'day' };
    const y = /(\d{4})/.exec(text)?.[1];
    return y ? { releaseDate: `${y}-01-01`, datePrecision: 'year' } : { releaseDate: null, datePrecision: 'none' };
}

export function authorFromHardcover(a) {
    if (!a) return null;
    return {
        hardcoverId: num(a.id),
        name: str(a.name),
        slug: str(a.slug),
        bio: str(a.bio),
        bornYear: num(a.born_year),
        location: str(a.location),
        imageUrl: imageUrl(a.cached_image) || imageUrl(a.image),
        booksCount: num(a.books_count),
    };
}

export { clean as cleanIsbn };
