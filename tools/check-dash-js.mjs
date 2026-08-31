// Parse the dashboard's inline script the way the browser will.
//
// The API can prove the DATA is right and say nothing about whether the page
// renders it. A stray backtick or brace in a template literal - easy to
// introduce when editing a 550-line HTML file with nested `${}` - produces a
// blank screen and one console error, which is exactly the failure mode the
// project's own rule about unverified claims exists to catch.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('E:/Gateflame/fleet/static/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

if (scripts.length === 0) {
  console.log('no inline script found - that is itself suspicious');
  process.exit(1);
}

let failed = false;
scripts.forEach((src, i) => {
  try {
    // Compile only. Never run it: the page talks to the network and touches
    // document on load, and neither belongs in a syntax check.
    new vm.Script(src, { filename: `inline-script-${i}.js` });
    console.log(`inline script ${i}: parses OK (${src.length} chars)`);
  } catch (e) {
    failed = true;
    console.log(`inline script ${i}: SYNTAX ERROR -> ${e.message}`);
  }
});

// The identifiers the new panels depend on. A typo here renders an empty card
// rather than throwing, so grep for them explicitly.
const required = ['findingsCard', 'shieldCard', 'n.findings', 'n.shieldReported', 'sh.devices'];
for (const token of required) {
  if (!html.includes(token)) {
    failed = true;
    console.log(`MISSING: ${token}`);
  }
}
if (!failed) console.log('all new-panel identifiers present');
process.exit(failed ? 1 : 0);
