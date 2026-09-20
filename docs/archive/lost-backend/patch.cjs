const fs = require('fs');
let content = fs.readFileSync('src/components/SettingsManager.tsx', 'utf8');
content = content.replace(/const \{ activeModules, toggleModule \} = useAppStore\(state => \(\{[\s\S]*?\}\)\);/, "const activeModules = useAppStore(state => state.activeModules);\n  const toggleModule = useAppStore(state => state.toggleModule);");
fs.writeFileSync('src/components/SettingsManager.tsx', content);
