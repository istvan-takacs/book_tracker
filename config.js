// App configuration. Fill this in during setup (README → Setup).
// None of these values are secret: Firebase web config is public by design
// (Firestore rules protect the data) and the Google Books key is restricted
// to your site by HTTP referrer. The Hardcover token lives only in the Worker.
//
// While firebaseConfig.apiKey is empty the app runs in preview mode:
// data stays in this browser and search uses Google Books + Open Library.

// Firebase web config (Firebase console → Project settings → Your apps).
// Paste only this object: the console's import/initializeApp/getAnalytics lines
// need a bundler and are not used here; js/firebase.js initialises Firebase.
export const firebaseConfig = {
  apiKey: "AIzaSyAOt3sAXY91kzzbzuozewhcWSc_6TyaurI",
  authDomain: "book-tracker-61650.firebaseapp.com",
  projectId: "book-tracker-61650",
  storageBucket: "book-tracker-61650.firebasestorage.app",
  messagingSenderId: "638109777672",
  appId: "1:638109777672:web:a1c7c161dfb3ce70a8f6bd",
  measurementId: "G-FPMB3Y1LES"
};

// Google Books API key (optional; without it you share Google's anonymous quota).
export const googleBooksKey = 'AIzaSyD4e9JDkLbJF_tgq2WR1HNi9QkzzyDYb20';

// Deployed Cloudflare Worker, e.g. 'https://book-tracker.<you>.workers.dev'.
// For local development: 'http://localhost:8787' (wrangler dev).
export const workerUrl = 'https://book-tracker.istvan-takacs.workers.dev';

// Public URL of the app, used in calendar event links.
export const appUrl = 'https://istvan-takacs.github.io/book_tracker/';
