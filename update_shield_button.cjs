const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

code = code.replace(
  /className="relative group focus:outline-none"/,
  'className="relative group focus:outline-none transition-transform active:scale-95 duration-200"'
);

fs.writeFileSync('src/components/MobileDashboard.tsx', code);
