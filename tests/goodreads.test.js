import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, importGoodreads, seriesFromTitle, cleanTitle } from '../js/lib/goodreads.js';

const HEADER = 'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';
const CSV = [
    HEADER,
    '1,"Mistborn: The Final Empire (Mistborn, #1)",Brandon Sanderson,"Sanderson, Brandon",,"=""0765311780""","=""9780765311788""",5,4.47,Tor,Paperback,541,2006,2006,2024/09/14,2024/08/01,,,read,"Loved it, ""truly"".",,,2,1',
    '2,The Blade Itself,Joe Abercrombie,"Abercrombie, Joe",,"=""""","=""""",0,4.18,Gollancz,Kindle Edition,515,2006,2006,,2025/01/02,"to-read, fantasy","to-read (#3), fantasy (#1)",to-read,,,,0,0',
    '3,Some Book,A Writer,"Writer, A",,"=""""","=""""",2,3.1,X,Audible Audio,300,2020,2020,,2025/02/02,dnf,dnf (#1),dnf,,,,0,0',
    '4,Now Reading,B Writer,"Writer, B",,"=""""","=""""",0,3.9,Y,Hardcover,250,2021,2021,,2026/10/01,currently-reading,,currently-reading,,,,0,0',
].join('\n');

test('CSV parser handles quotes, escaped quotes and embedded commas', () => {
    const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n');
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('series in Goodreads titles', () => {
    assert.deepEqual(seriesFromTitle('Mistborn: The Final Empire (Mistborn, #1)'), { name: 'Mistborn', position: 1 });
    assert.equal(cleanTitle('Mistborn: The Final Empire (Mistborn, #1)'), 'Mistborn: The Final Empire');
});

test('maps shelves, ratings ×2, dates, formats and re-reads', () => {
    const { books, summary } = importGoodreads(CSV);
    assert.deepEqual(summary, { total: 4, read: 1, reading: 1, want: 1, dnf: 1 });
    const [mistborn, blade, dnf, reading] = books;
    assert.equal(mistborn.rating, 10);
    assert.equal(mistborn.isbn13, '9780765311788');
    assert.equal(mistborn.reads.length, 2, 'Read Count 2 → two reads');
    assert.equal(mistborn.reads[1].finishedAt, '2024-09-14');
    assert.deepEqual(mistborn.reads[1].formats, ['print']);
    assert.equal(mistborn.review, 'Loved it, "truly".');
    assert.equal(mistborn.owned, true);
    assert.equal(blade.status, 'want');
    assert.equal(blade.rating, null);
    assert.deepEqual(blade.customShelves, ['fantasy']);
    assert.equal(dnf.status, 'dnf');
    assert.equal(reading.status, 'reading');
});

test('rejects files that are not Goodreads exports', () => {
    assert.throws(() => importGoodreads('title,author\nX,Y'), /Goodreads export/);
});
