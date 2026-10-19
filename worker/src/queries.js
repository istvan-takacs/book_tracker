// The only Hardcover operations the Worker will run. Read-only, one top-level
// field each (Hardcover counts each top-level field against the rate limit).
// Field names: docs/hardcover-fields.md.

const CARD = `
  id title slug release_date release_year pages audio_seconds rating ratings_count users_count compilation cached_image
  contributions { contribution author { id name } }
  book_series { position featured series { id name primary_books_count books_count } }`;

const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const text = (max) => (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const ids = (max) => (v) => Array.isArray(v) && v.length > 0 && v.length <= max && v.every(int(1, 2 ** 31));
const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const digits = (n) => (v) => typeof v === 'string' && new RegExp(`^[0-9X]{${n}}$`).test(v);

const HOUR = 3600;

export const OPERATIONS = {
    searchBooks: {
        ttl: 6 * HOUR,
        vars: { q: text(200), n: int(1, 25) },
        query: `query searchBooks($q: String!, $n: Int!) { search(query: $q, query_type: "book", per_page: $n, page: 1) { results } }`,
    },
    searchAuthors: {
        ttl: 6 * HOUR,
        vars: { q: text(200), n: int(1, 25) },
        query: `query searchAuthors($q: String!, $n: Int!) { search(query: $q, query_type: "author", per_page: $n, page: 1) { results } }`,
    },
    searchSeries: {
        ttl: 6 * HOUR,
        vars: { q: text(200), n: int(1, 25) },
        query: `query searchSeries($q: String!, $n: Int!) { search(query: $q, query_type: "series", per_page: $n, page: 1) { results } }`,
    },
    bookById: {
        ttl: 24 * HOUR,
        vars: { id: int(1, 2 ** 31) },
        query: `query bookById($id: Int!) { books(where: {id: {_eq: $id}}, limit: 1) { ${CARD}
            subtitle description cached_tags cached_similar_book_ids
            default_physical_edition { pages release_date isbn_13 publisher { name } }
            default_audio_edition { audio_seconds contributions { contribution author { name } } }
            editions(order_by: {users_count: desc}, limit: 10) { id edition_format reading_format_id pages release_date isbn_13 isbn_10 audio_seconds publisher { name } } } }`,
    },
    authorById: {
        ttl: 24 * HOUR,
        vars: { id: int(1, 2 ** 31) },
        query: `query authorById($id: Int!) { authors(where: {id: {_eq: $id}}, limit: 1) {
            id name slug bio born_year location cached_image books_count
            contributions(where: {contributable_type: {_eq: "Book"}}, order_by: {book: {users_count: desc}}, limit: 60) {
              contribution book { ${CARD} canonical_id } } } }`,
    },
    authorBooks: {
        ttl: 12 * HOUR,
        vars: { ids: ids(50), since: isoDate, year: int(1900, 3000) },
        query: `query authorBooks($ids: [Int!]!, $since: date!, $year: Int!) { books(where: {_and: [
              {contributions: {author_id: {_in: $ids}}},
              {canonical_id: {_is_null: true}},
              {_or: [{release_date: {_gte: $since}}, {_and: [{release_date: {_is_null: true}}, {release_year: {_gte: $year}}]}]}
            ]}, order_by: {release_date: asc_nulls_last}, limit: 100) { ${CARD} } }`,
    },
    seriesBooks: {
        ttl: 12 * HOUR,
        vars: { ids: ids(50) },
        query: `query seriesBooks($ids: [Int!]!) { series(where: {id: {_in: $ids}}) {
            id name books_count primary_books_count is_completed author { id name }
            book_series(distinct_on: position, order_by: [{position: asc}, {book: {users_count: desc}}],
              where: {book: {canonical_id: {_is_null: true}, is_partial_book: {_eq: false}}, compilation: {_eq: false}}) {
              position book { ${CARD} } } } }`,
    },
    editionByIsbn: {
        ttl: 7 * 24 * HOUR,
        vars: { isbn13: digits(13), isbn10: digits(10) },
        query: `query editionByIsbn($isbn13: String!, $isbn10: String!) { editions(where: {_or: [{isbn_13: {_eq: $isbn13}}, {isbn_10: {_eq: $isbn10}}]}, limit: 1) {
            id isbn_13 edition_format pages release_date book { ${CARD} description cached_tags } } }`,
    },
    booksByIds: {
        ttl: 24 * HOUR,
        vars: { ids: ids(30) },
        query: `query booksByIds($ids: [Int!]!) { books(where: {id: {_in: $ids}}, limit: 30) { ${CARD} } }`,
    },
};

/** Returns an error message, or null when the variables are acceptable. */
export function validateVariables(opName, variables) {
    const op = OPERATIONS[opName];
    if (!op) return 'unknown_operation';
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return 'invalid_variables';
    const keys = Object.keys(variables);
    for (const k of keys) if (!(k in op.vars)) return `unexpected_variable:${k}`;
    for (const [k, check] of Object.entries(op.vars)) if (!check(variables[k])) return `invalid_variable:${k}`;
    return null;
}
