import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { getLang, subscribeLang } from './lib/i18n';
import { PlannerPage } from './pages/PlannerPage';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

/** Re-mounts the app when the language changes, so every string and label re-renders. */
function App() {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  return <PlannerPage key={lang} />;
}

document.documentElement.lang = getLang();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Precaches the app shell and API strategies from vite.config.ts; updates itself.
registerSW({ immediate: true });
