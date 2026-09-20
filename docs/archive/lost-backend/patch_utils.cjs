const fs = require('fs');
let content = fs.readFileSync('src/lib/utils.ts', 'utf8');

content = content.replace(/dark:border-purple-500\/50/g, "dark:border-blue-500/50");
content = content.replace(/dark:shadow-\[0_0_2px_1px_rgba\(168,85,247,0\.5\)\]/g, "dark:shadow-[0_0_2px_1px_rgba(59,130,246,0.5)]");
content = content.replace(/dark:text-purple-400/g, "dark:text-blue-400");
content = content.replace(/dark:text-orange-400/g, "dark:text-blue-400");

fs.writeFileSync('src/lib/utils.ts', content);
