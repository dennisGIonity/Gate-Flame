const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

// Replace dropdown select / buttons with active:scale-95
code = code.replace(
  'className="flex items-center gap-2 px-3 py-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors"',
  'className="flex items-center gap-2 px-3 py-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-all active:scale-95"'
);

code = code.replace(
  /className="p-1\.5 bg-black\/5 dark:bg-white\/5 hover:bg-black\/10 dark:hover:bg-white\/10 rounded-full transition-colors"/g,
  'className="p-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-all active:scale-95"'
);

// Tab buttons
code = code.replace(
  /className="relative p-3 flex flex-col items-center justify-center min-w-\[44px\] min-h-\[44px\] w-1\\\/3 flex-1 snap-center focus:outline-none"/,
  'className="relative p-3 flex flex-col items-center justify-center min-w-[44px] min-h-[44px] w-1/3 flex-1 snap-center focus:outline-none transition-transform active:scale-90"'
);

// Filter category buttons
code = code.replace(
  /"px-3 py-1 rounded-full text-\[10px\] font-mono transition-all whitespace-nowrap",/g,
  '"px-3 py-1 rounded-full text-[10px] font-mono transition-all whitespace-nowrap active:scale-95",'
);

// Protection level buttons
code = code.replace(
  /className="flex items-center gap-2 p-3 rounded-xl bg-black\/\[0\.02\] dark:bg-white\/\[0\.02\] border border-black\/5 dark:border-white\/5 hover:bg-white\/5 transition-colors"/g,
  'className="flex items-center gap-2 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 hover:bg-white/5 transition-all active:scale-95"'
);

// 3D Shield (Wait, I need to wrap it in a motion.button or button to make it ripple)
// I will just use sed or manually edit the shield later.

fs.writeFileSync('src/components/MobileDashboard.tsx', code);
