const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');
const lines = code.split('\n');

const errors = [271, 286, 343, 383, 439, 460, 486, 601];
errors.forEach(line => {
    const idx = line - 1;
    lines[idx] = lines[idx].replace('</div>', '</GlassPanel>');
});
fs.writeFileSync('src/components/MobileDashboard.tsx', lines.join('\n'));
