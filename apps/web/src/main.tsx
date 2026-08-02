import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root was not found in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Page views, started only once the dashboard is already mounted.
 *
 * `inject` loads a script from Vercel, which an ad blocker, an offline browser or a strict
 * content policy can all stop. Running it above the render meant any of those took the
 * league down with it and left a blank page; running it after, and swallowing the failure,
 * means the worst case is missing analytics rather than a missing dashboard.
 *
 * It is a no-op outside a Vercel deployment, so local development is unaffected.
 */
try {
  inject();
} catch {
  // Never worth a broken page.
}
