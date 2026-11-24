import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { PlannerPage } from './pages/PlannerPage';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <PlannerPage />
  </StrictMode>,
);

// Precaches the app shell and API strategies from vite.config.ts; updates itself.
registerSW({ immediate: true });
