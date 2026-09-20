const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.scripts['package:release'] = "mkdir -p release && npm run build:html-mobile && npm run build:html-kiosk && tar -czvf release/GateFlame-Complete-Package.tar.gz dist-mobile dist-kiosk";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
