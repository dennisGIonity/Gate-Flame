const fs = require('fs');
let content = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

const insertion = `                )}
                {activeModules.includes(activeTab) && (
                    <DynamicModuleView moduleId={activeTab} />
                )}`;

content = content.replace(/                \)}\s*<\/AnimatePresence>/, insertion + '\n                </AnimatePresence>');
fs.writeFileSync('src/components/MobileDashboard.tsx', content);
