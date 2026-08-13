const fs = require('fs');

let code = fs.readFileSync('src/main.tsx', 'utf8');

code = code.replace(
  /window\.addEventListener\('error', \(e\) => \{[\s\S]*?\}\);/,
  `const resizeObserverErrDiv = document.createElement('div');
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop limit exceeded' || e.message === 'ResizeObserver loop completed with undelivered notifications.') {
    const errOverlay = document.getElementById('vite-error-overlay');
    if (errOverlay) {
      errOverlay.remove();
    }
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});`
);

fs.writeFileSync('src/main.tsx', code);
