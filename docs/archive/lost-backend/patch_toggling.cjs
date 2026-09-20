const fs = require('fs');
let content = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

// Remove unused toggling state and function
const removePattern = /  const \[togglingModules, setTogglingModules\] = useState<Record<string, boolean>>\(\{\}\);\s*const handleToggleModule = async \(moduleId: string, enable: boolean\) => \{[\s\S]*?\}\s*setTogglingModules\(prev => \(\{ \.\.\.prev, \[moduleId\]: false \}\)\);\s*\};\s*/;
content = content.replace(removePattern, '');

// Add a useEffect to reset activeTab if the module is turned off
const useEffectInsertion = `
  React.useEffect(() => {
    // If current activeTab is a module, but it's no longer active, switch to dashboard
    if (activeTab !== 'dashboard' && activeTab !== 'shield' && activeTab !== 'threats' && activeTab !== 'clients' && activeTab !== 'terminal' && activeTab !== 'game' && activeTab !== 'settings') {
      if (!activeModules.includes(activeTab)) {
        setActiveTab('dashboard');
      }
    }
  }, [activeModules, activeTab]);
`;

content = content.replace("  const handleWhitelistSubmit = (e: React.FormEvent) => {", useEffectInsertion + "\n  const handleWhitelistSubmit = (e: React.FormEvent) => {");

fs.writeFileSync('src/components/MobileDashboard.tsx', content);
