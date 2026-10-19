import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseEvent, googleCalendarUrl, buildIcs, calendarBooks, subscribeUrl } from '../js/lib/calendar.js';

const book = { key: 'hc_9', title: 'Tidewright', authors: [{ name: 'Ines Vahl' }], series: { name: 'The Salt Courts', position: 3 } };

test('Google Calendar template link is an all-day event', () => {
    const url = new URL(googleCalendarUrl(releaseEvent(book, '2026-10-22')));
    assert.equal(url.searchParams.get('dates'), '20261022/20261023');
    assert.equal(url.searchParams.get('text'), 'Tidewright (Ines Vahl) is out');
});

test('ICS: stable UIDs, all-day dates, escaping, CRLF and folding', () => {
    const e = releaseEvent({ ...book, title: 'Salt; Brine, and a very long title that will need folding because it is long' }, '2026-12-31');
    const ics = buildIcs([e], { now: new Date('2026-10-19T10:00:00Z') });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /UID:hc_9@book-tracker\r\n/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
    assert.match(ics, /SUMMARY:Salt\\; Brine\\, and/);
    assert.match(ics, /DTSTAMP:20261019T100000Z/);
    for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
    assert.match(ics, /\r\n /, 'long lines are folded');
});

test('only TBR/upcoming books with exact or manual dates go in the calendar', () => {
    const today = '2026-10-19';
    const list = calendarBooks([
        { key: 'a', status: 'upcoming', releaseDate: '2026-10-22', datePrecision: 'day' },
        { key: 'b', status: 'upcoming', releaseDate: '2027-01-01', datePrecision: 'year' },
        { key: 'c', status: 'upcoming', releaseDate: '2027-01-01', datePrecision: 'year', releaseDateOverride: { date: '2027-04-15' } },
        { key: 'd', status: 'read', releaseDate: '2026-10-25', datePrecision: 'day' },
        { key: 'e', status: 'want', releaseDate: '2026-01-01', datePrecision: 'day' },
    ], today);
    assert.deepEqual(list.map((x) => [x.book.key, x.date]), [['a', '2026-10-22'], ['c', '2027-04-15']]);
});

test('subscribe link uses webcal', () => {
    assert.equal(subscribeUrl('https://w.example/cal/abc.ics'), 'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fw.example%2Fcal%2Fabc.ics');
});
