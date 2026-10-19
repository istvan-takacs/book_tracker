// Calendar output: one-off "Add to Google Calendar" links and RFC 5545 .ics
// feeds. Shared by the app (downloads) and the Worker (subscribed feed).

import { parseDay, toIso } from './dates.js';

const compact = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => toIso(parseDay(iso) + 86400000);

/** An all-day event for a release. `book` needs title, authors, and a day-precise date. */
export function releaseEvent(book, date, { appUrl = '' } = {}) {
    const author = book.authors?.[0]?.name;
    const series = book.series?.name ? `${book.series.name}${book.series.position ? `, book ${book.series.position}` : ''}` : null;
    return {
        uid: `${book.key}@book-tracker`,
        date,
        title: `${book.title}${author ? ` (${author})` : ''} is out`,
        description: [series, book.releaseDateOverride?.date ? 'Release date set by you.' : null, appUrl && book.key ? `${appUrl}#/book/${book.key}` : null].filter(Boolean).join('\n'),
    };
}

export function googleCalendarUrl(event) {
    const p = new URLSearchParams({
        action: 'TEMPLATE',
        text: event.title,
        dates: `${compact(event.date)}/${compact(nextDay(event.date))}`,
        details: event.description || '',
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function escapeText(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = [];
    let cur = '', curLen = 0;
    for (const ch of line) {
        const n = new TextEncoder().encode(ch).length;
        if (curLen + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; curLen = 0; }
        cur += ch; curLen += n;
    }
    out.push(cur);
    return out.join('\r\n ');
}

export function buildIcs(events, { name = 'Book releases', now = new Date() } = {}) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//book-tracker//releases//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(name)}`,
        'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
        'X-PUBLISHED-TTL:PT12H',
    ];
    for (const e of events) {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${e.uid}`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${compact(e.date)}`,
            `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
            `SUMMARY:${escapeText(e.title)}`,
            ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
            'TRANSP:TRANSPARENT',
            'END:VEVENT',
        );
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}

/** Books that belong in the calendar: TBR or upcoming, with an exact (or manual) date. */
export function calendarBooks(books, today, { pastDays = 30 } = {}) {
    const cutoff = toIso(parseDay(today) - pastDays * 86400000);
    return books
        .filter((b) => ['upcoming', 'want'].includes(b.status))
        .map((b) => ({ book: b, date: b.releaseDateOverride?.date || (b.datePrecision === 'day' ? b.releaseDate : null) }))
        .filter((x) => x.date && x.date >= cutoff);
}

/** Google Calendar's "subscribe by URL" deep link for a webcal feed. */
export function subscribeUrl(httpsFeedUrl) {
    const webcal = httpsFeedUrl.replace(/^https?:/, 'webcal:');
    return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}
