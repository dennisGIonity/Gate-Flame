const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts['build:standalone'] = "vite build -c vite.standalone.config.ts";
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
