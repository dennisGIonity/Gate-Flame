const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

code = code.replace(
  /<Tooltip\s+cursor=\{\{ fill: 'rgba\(255,255,255,0\.02\)' \}\}\s+contentStyle=\{\{ backgroundColor: '#0a0a0a', borderColor: '#262626', borderRadius: '12px', fontSize: '10px', color: '#fff', padding: '6px' \}\}\s+\/>/g,
  `<Tooltip
    cursor={{ fill: userAccount.appTheme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}
    contentStyle={{ 
        backgroundColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0a0a0a' : '#ffffff', 
        borderColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#262626' : '#e5e7eb', 
        borderRadius: '12px', 
        fontSize: '10px', 
        color: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#fff' : '#0f172a', 
        padding: '6px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    }}
/>`
);

fs.writeFileSync('src/components/MobileDashboard.tsx', code);
