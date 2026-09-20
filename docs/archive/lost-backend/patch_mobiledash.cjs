const fs = require('fs');
let content = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

// Increase bottom padding
content = content.replace(/className="flex-1 overflow-y-auto no-scrollbar pb-20 relative z-10/g, 'className="flex-1 overflow-y-auto no-scrollbar pb-32 relative z-10');

// Add redirect effect
const effectCode = `
  React.useEffect(() => {
    const validTabs = ['dashboard', 'shield', 'threats', 'clients', 'terminal', 'game', 'settings'];
    if (!validTabs.includes(activeTab) && !activeModules.includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeModules, activeTab]);
`;

content = content.replace(/const TABS = \[.*?\];/g, "const TABS = [...baseTabs, ...dynamicTabs, { id: 'settings', icon: SlidersHorizontal, label: 'Settings' }];\n" + effectCode);

fs.writeFileSync('src/components/MobileDashboard.tsx', content);
