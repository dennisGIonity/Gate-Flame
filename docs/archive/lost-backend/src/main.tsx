
// Ignore benign ResizeObserver errors caused by Recharts/Canvas resizing
const resizeObserverLoopErrRe = /^[^(ResizeObserver loop limit exceeded)]/;
const resizeObserverErrDiv = document.createElement('div');
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop limit exceeded' || e.message === 'ResizeObserver loop completed with undelivered notifications.') {
    const errOverlay = document.getElementById('vite-error-overlay');
    if (errOverlay) {
      errOverlay.remove();
    }
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
