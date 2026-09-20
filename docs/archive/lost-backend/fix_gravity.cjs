const fs = require('fs');

let code = fs.readFileSync('src/components/GravityParticleCanvas.tsx', 'utf8');

code = code.replace(
  /render\(\);/,
  "animationFrameId = requestAnimationFrame(render);"
);

fs.writeFileSync('src/components/GravityParticleCanvas.tsx', code);
