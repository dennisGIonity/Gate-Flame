const fs = require('fs');
let code = fs.readFileSync('src/main.tsx', 'utf8');

const errorHandler = `
// Ignore benign ResizeObserver errors caused by Recharts/Canvas resizing
const resizeObserverLoopErrRe = /^[^(ResizeObserver loop limit exceeded)]/;
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop limit exceeded' || e.message === 'ResizeObserver loop completed with undelivered notifications.') {
    e.stopImmediatePropagation();
  }
});
`;

code = errorHandler + "\n" + code;
fs.writeFileSync('src/main.tsx', code);
