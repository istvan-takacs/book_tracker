// Late-bound services provided by app.js (keeps views free of Firebase imports).
export const services = {
    mode: 'preview',
    user: null,
    signIn: async () => {},
    signOut: async () => {},
    calendar: {
        available: false,
        feedUrl: () => null,
        ensure: async () => null,
        reset: async () => null,
    },
    resetPreview: () => {},
};
