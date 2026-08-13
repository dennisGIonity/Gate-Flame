const fs = require('fs');
let code = fs.readFileSync('src/index.css', 'utf8');

// Remove the incorrect dark body override
code = code.replace(
  /\.dark body, .dark body\[data-filter-level="none"\], .dark body\[data-filter-level="low"\], .dark body\[data-filter-level="medium"\], .dark body\[data-filter-level="high"\] {    --glass-border-color: rgba\(14, 165, 233, 0\.6\) !important;    --glass-glow: 0 0 16px 2px rgba\(14, 165, 233, 0\.25\) !important;  }/,
  ""
);

code = code.replace(
  /@layer base {/,
  `@property --glass-border-color {
  syntax: '<color>';
  inherits: true;
  initial-value: rgba(14, 165, 233, 0.6);
}

@layer base {`
);

// We can't easily interpolate box-shadow directly through a property if we define it as a list, but transition-all on .glass-panel handles box-shadow interpolation automatically when the variable changes the final computed value.

fs.writeFileSync('src/index.css', code);
