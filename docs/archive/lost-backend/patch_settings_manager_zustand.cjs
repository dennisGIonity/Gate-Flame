const fs = require('fs');
let content = fs.readFileSync('src/components/SettingsManager.tsx', 'utf8');

const oldSelector = `  const { activeModules, toggleModule } = useAppStore(state => ({
    activeModules: state.activeModules,
    toggleModule: state.toggleModule,
      }));`;
const newSelector = `  const activeModules = useAppStore(state => state.activeModules);
  const toggleModule = useAppStore(state => state.toggleModule);`;

content = content.replace(oldSelector, newSelector);
fs.writeFileSync('src/components/SettingsManager.tsx', content);
