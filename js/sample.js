// A small fictional library for preview mode, so every screen has something
// to show before you connect Firebase or import from Goodreads.

import { store } from './store.js';
import { todayIso, toIso, parseDay } from './lib/dates.js';

export async function seedSampleLibrary() {
    const today = todayIso();
    const day = (offset) => toIso(parseDay(today) + offset * 86400000);
    const year = today.slice(0, 4);
    const read = (finishedAt, rating, extra = {}) => ({ startedAt: day(-((parseDay(today) - parseDay(finishedAt)) / 86400000) - 18), finishedAt, rating, formats: ['print'], ...extra });
    const iv = [{ id: null, name: 'Ines Vahl' }];
    const om = [{ id: null, name: 'Odile Marsh' }];
    const ka = [{ id: null, name: 'Kenji Ard' }];
    const books = {
        sample_salt: { title: 'The Salt Courts', authors: iv, series: { name: 'The Salt Courts', position: 1 }, pageCount: 512, status: 'read', rating: 10, reads: [read(`${Number(year) - 2}-09-10`, 9), read(day(-210), 10, { formats: ['print', 'audio'], moods: ['epic', 'political', 'dark'], scales: { tone: 'dark', drivenBy: 'characters' } })], review: 'Even better the second time.' },
        sample_brine: { title: 'A Crown of Brine', authors: iv, series: { name: 'The Salt Courts', position: 2 }, pageCount: 480, status: 'read', rating: 9, reads: [read(day(-44), 9, { moods: ['dark', 'political'], scales: { tone: 'dark', pace: 'medium' } })] },
        sample_tide: { title: 'Tidewright', authors: iv, series: { name: 'The Salt Courts', position: 3 }, status: 'upcoming', releaseDate: day(3), datePrecision: 'day', isNew: true },
        sample_lantern: { title: 'Lanternfall', authors: om, series: { name: 'Lanternfall', position: 1 }, pageCount: 420, status: 'read', rating: 9, reads: [read(day(-100), 9, { moods: ['dark', 'mysterious'], scales: { tone: 'dark', drivenBy: 'characters' } })] },
        sample_ashen: { title: 'The Ashen Choir', authors: om, series: { name: 'Lanternfall', position: 3 }, status: 'upcoming', releaseDate: `${Number(year) + 1}-01-01`, datePrecision: 'year' },
        sample_orbit: { title: 'The Long Orbit', authors: ka, series: { name: 'The Orbit Cycle', position: 1 }, pageCount: 388, audioSeconds: 680 * 60, status: 'reading', reads: [{ startedAt: day(-17), finishedAt: null, rating: null, formats: ['print', 'audio'] }], progress: { fraction: 212 / 388, mode: 'page' } },
        sample_ledger: { title: 'The Quiet Ledger', authors: [{ id: null, name: 'Tobias Rehn' }], status: 'upcoming', releaseDate: day(10), datePrecision: 'day', verified: false },
        sample_cold: { title: 'Cold Arithmetic', authors: [{ id: null, name: 'Tobias Rehn' }], pageCount: 350, status: 'read', rating: 8, reads: [read(day(-14), 8, { formats: ['ebook'], moods: ['twisty', 'dark'], scales: { pace: 'fast', tone: 'dark' } })] },
        sample_weir: { title: 'The Gilded Weir', authors: [{ id: null, name: 'Ada Okafor' }], pageCount: 400, status: 'want' },
        sample_velvet: { title: 'The Velvet Index', authors: [{ id: null, name: 'Jonah Prior' }], pageCount: 300, status: 'dnf', reads: [{ startedAt: day(-60), abandonedAt: day(-50), stoppedAt: 0.23, formats: ['ebook'] }] },
    };
    const now = new Date().toISOString();
    await store.batch(Object.entries(books).map(([key, b]) => ({ collection: 'books', key, patch: { verified: true, addedAt: now, ...b, key } })));
    await store.batch([
        { collection: 'authors', key: 'name_ines-vahl', patch: { name: 'Ines Vahl', followed: true } },
        { collection: 'authors', key: 'name_odile-marsh', patch: { name: 'Odile Marsh', followed: true } },
        { collection: 'authors', key: 'name_tobias-rehn', patch: { name: 'Tobias Rehn', followed: true } },
        { collection: 'series', key: 'name_the-salt-courts', patch: { name: 'The Salt Courts', followed: true, maxPositionRead: 2, authorNames: ['Ines Vahl'], total: 3,
            books: [{ key: 'sample_salt', title: 'The Salt Courts', position: 1 }, { key: 'sample_brine', title: 'A Crown of Brine', position: 2 }, { key: 'sample_tide', title: 'Tidewright', position: 3, releaseDate: day(3), datePrecision: 'day' }] } },
        { collection: 'series', key: 'name_lanternfall', patch: { name: 'Lanternfall', followed: true, maxPositionRead: 1, authorNames: ['Odile Marsh'], total: 3,
            books: [{ key: 'sample_lantern', title: 'Lanternfall', position: 1 }, { key: 'sample_embers', title: 'Embers Below', position: 2, releaseDate: `${Number(year) - 1}-05-01`, datePrecision: 'day' }, { key: 'sample_ashen', title: 'The Ashen Choir', position: 3 }] } },
    ]);
    await store.saveSettings({ goals: { [year]: 24 }, onboardedAt: store.settings.onboardedAt || now });
}
