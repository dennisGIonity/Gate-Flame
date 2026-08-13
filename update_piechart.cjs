const fs = require('fs');
let code = fs.readFileSync('src/components/DeviceOnboardingSimulator.tsx', 'utf8');

code = code.replace(
  /<Tooltip contentStyle=\{\{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '8px', fontSize: '11px', color: '#F8FAFC' \}\} \/>/g,
  `<Tooltip contentStyle={{ 
    backgroundColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0F172A' : '#ffffff', 
    borderColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#334155' : '#e5e7eb', 
    borderRadius: '8px', 
    fontSize: '11px', 
    color: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#F8FAFC' : '#0f172a',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
  }} />`
);

fs.writeFileSync('src/components/DeviceOnboardingSimulator.tsx', code);
