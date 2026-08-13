const fs = require('fs');
let content = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

// Insert import if not present
if (!content.includes("import { SettingsManager }")) {
  content = content.replace("import { DynamicModuleView } from './DynamicModuleView';", "import { DynamicModuleView } from './DynamicModuleView';\nimport { SettingsManager } from './SettingsManager';");
}

// Replace the inline Service Manager block
const pattern = /\{\/\* Service Manager \*\/\}.*?<div className="h-px w-full bg-sky-100 dark:bg-white\/5" \/>\s*<div>\s*<h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Whitelist<\/h3>/s;

content = content.replace(pattern, `                            {/* Service Manager */}
                            <SettingsManager />
                            <div className="h-px w-full bg-sky-100 dark:bg-white/5" />
                            <div>
                            <h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Whitelist</h3>`);

fs.writeFileSync('src/components/MobileDashboard.tsx', content);
