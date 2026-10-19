// Release-date precision, labels and timeline grouping.
// Dates are ISO strings (YYYY-MM-DD) handled as UTC calendar days so a
// release never shifts by a day with the device's timezone.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;

export function parseDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

export function toIso(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

export function todayIso(now = new Date()) {
    return toIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Work out how precise a release date is.
 * Hardcover gives `release_date` (date) and `release_year`. Unknown days are not
 * documented; until verified live, a *future* 1 January or 31 December is treated
 * as "year only" (docs/hardcover-fields.md).
 */
export function precisionOf({ date, year, month } = {}, today = todayIso()) {
    if (date && !Number.isNaN(parseDay(date))) {
        const d = date.slice(0, 10);
        const placeholder = /-(01-01|12-31)$/.test(d) && d > today;
        return placeholder ? { date: d, precision: 'year' } : { date: d, precision: 'day' };
    }
    if (year && month) return { date: `${year}-${String(month).padStart(2, '0')}-01`, precision: 'month' };
    if (year) return { date: `${year}-01-01`, precision: 'year' };
    return { date: null, precision: 'none' };
}

/** Google Books publishedDate is "2027", "2027-03" or "2027-03-14". */
export function fromGooglePublished(published) {
    if (!published) return { date: null, precision: 'none' };
    const [y, m, d] = published.split('-');
    if (d) return { date: `${y}-${m}-${d}`, precision: 'day' };
    if (m) return { date: `${y}-${m}-01`, precision: 'month' };
    return { date: `${y}-01-01`, precision: 'year' };
}

const RANK = { none: 0, year: 1, month: 2, day: 3 };
export function morePrecise(a, b) {
    return RANK[a] > RANK[b];
}

/** The date the UI should use: a manual override always wins. */
export function effectiveRelease(book) {
    if (book?.releaseDateOverride?.date) return { date: book.releaseDateOverride.date, precision: 'day', manual: true };
    return { date: book?.releaseDate || null, precision: book?.datePrecision || (book?.releaseDate ? 'day' : 'none'), manual: false };
}

export function daysBetween(fromIso, toIsoStr) {
    return Math.round((parseDay(toIsoStr) - parseDay(fromIso)) / DAY_MS);
}

/** "Thursday 22 October", with the year added when it differs from `today`. */
export function formatDay(iso, today = todayIso(), { weekday = true } = {}) {
    const d = new Date(parseDay(iso));
    const sameYear = iso.slice(0, 4) === today.slice(0, 4);
    const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${sameYear ? '' : ' ' + d.getUTCFullYear()}`;
    return weekday ? `${DAYS[d.getUTCDay()]} ${base}` : base;
}

export function formatRelease({ date, precision }, today = todayIso()) {
    if (!date || precision === 'none') return 'No date yet';
    if (precision === 'year') return `Expected some time in ${date.slice(0, 4)}`;
    if (precision === 'month') {
        const d = new Date(parseDay(date));
        return `Expected ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    return formatDay(date, today);
}

/** "today", "tomorrow", "in 3 days", "in 2 weeks", "yesterday", "5 days ago", "2 weeks ago". */
export function relativeDays(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    const abs = Math.abs(days);
    const unit = abs >= 14 && abs < 120 ? `${Math.round(abs / 7)} weeks` : `${abs} days`;
    return days > 0 ? `in ${unit}` : `${unit} ago`;
}

/**
 * Upcoming timeline bucket. Books more than 30 days past drop off the timeline.
 * thisWeek = the next 7 days; thisMonth = the rest of this calendar month.
 */
export function timeframe({ date, precision }, today = todayIso()) {
    if (!date || precision === 'none') return 'later';
    if (precision !== 'day') return date.slice(0, 7) < today.slice(0, 7) ? 'recent' : 'later';
    const days = daysBetween(today, date);
    if (days < -30) return 'past';
    if (days < 0) return 'recent';
    if (days <= 7) return 'thisWeek';
    if (date.slice(0, 7) === today.slice(0, 7)) return 'thisMonth';
    return 'later';
}

/** First day of the week from the device locale (0 = Sunday, 1 = Monday). Falls back to Monday. */
export function firstWeekday(locale) {
    try {
        const info = new Intl.Locale(locale).getWeekInfo?.() ?? new Intl.Locale(locale).weekInfo;
        if (info?.firstDay) return info.firstDay % 7;
    } catch { /* unsupported */ }
    return 1;
}

export { MONTHS, DAYS };
