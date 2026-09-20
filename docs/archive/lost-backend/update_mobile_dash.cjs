const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

// Add GlassPanel component
const glassPanelCode = `
const GlassPanel = ({ children, className, filterLevel }: { children: React.ReactNode, className?: string, filterLevel: string }) => {
  return (
    <div className={cn("relative z-0", className)}>
      <div className="absolute inset-0 bg-white/95 dark:bg-black/60 backdrop-blur-3xl rounded-[inherit] shadow-[0_8px_32px_rgba(0,0,0,0.05)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] pointer-events-none transition-colors duration-500 group-hover:bg-white dark:group-hover:bg-black/70" />
      <AnimatePresence>
        <motion.div
           key={filterLevel}
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
           transition={{ duration: 0.5, ease: 'easeInOut' }}
           className={cn("absolute inset-0 rounded-[inherit] pointer-events-none border", getFilterBorderColor(filterLevel))}
        />
      </AnimatePresence>
      <div className="relative z-10 h-full w-full flex flex-col rounded-[inherit]">
         {children}
      </div>
    </div>
  );
};
`;

code = code.replace(/export const MobileDashboard: React\.FC = \(\) => {/, glassPanelCode + '\nexport const MobileDashboard: React.FC = () => {');

// Add ripples state and handler
code = code.replace(/const \[showAllLogs, setShowAllLogs\] = useState\(false\);/, `const [showAllLogs, setShowAllLogs] = useState(false);\n  const [ripples, setRipples] = useState<{id: number, colorClass: string}[]>([]);`);

const cycleFilterLevelCode = `
  const handleShieldClick = () => {
    cycleFilterLevel();
    // Use the NEXT filter level color for the ripple so it feels responsive
    const levels = ['none', 'low', 'medium', 'high'];
    const nextIndex = (levels.indexOf(telemetry.filterLevel) + 1) % levels.length;
    setRipples(prev => [...prev, { id: Date.now(), colorClass: getFilterColor(levels[nextIndex]) }]);
  };
`;
code = code.replace(/const getFilterLevelLabel/, cycleFilterLevelCode + '\n  const getFilterLevelLabel');

// Replace button onClick and active duration
code = code.replace(/onClick={cycleFilterLevel}\s+className="relative group focus:outline-none transition-transform active:scale-95 duration-200"/, `onClick={handleShieldClick}\n                        className="relative group focus:outline-none transition-transform active:scale-95 duration-75"`);

// Replace ripple AnimatePresence
const rippleReplacement = `
                            {/* True Ripple Effect on click */}
                            <AnimatePresence>
                                {ripples.map(r => (
                                    <motion.div
                                        key={r.id}
                                        initial={{ scale: 0.8, opacity: 0.5 }}
                                        animate={{ scale: 1.5, opacity: 0 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.6, ease: "easeOut" }}
                                        onAnimationComplete={() => setRipples(prev => prev.filter(x => x.id !== r.id))}
                                        className={cn("absolute inset-0 rounded-full", r.colorClass)}
                                        style={{ backgroundColor: 'currentColor' }}
                                    />
                                ))}
                            </AnimatePresence>
`;
code = code.replace(/<AnimatePresence mode="wait">\s*<motion\.div\s*key=\{telemetry\.filterLevel\}[^>]*>\s*<\/motion\.div>\s*<\/AnimatePresence>/m, rippleReplacement);

// Replace glass-panels with <GlassPanel filterLevel={telemetry.filterLevel}>
// Let's replace the common class variations
code = code.replace(/<div className=\{cn\("glass-panel transition-colors duration-500 rounded-3xl p-5 h-\[280px\] flex flex-col"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 h-[280px] flex flex-col">`);

code = code.replace(/<div key=\{i\} className=\{cn\("glass-panel transition-colors duration-500 rounded-2xl p-4 flex flex-col justify-between hover:bg-white\/\[0\.02\]"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} key={i} className="group rounded-2xl p-4 flex flex-col justify-between">`);

code = code.replace(/<div className=\{cn\("glass-panel transition-colors duration-500 rounded-3xl p-5 h-\[200px\] flex flex-col"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 h-[200px] flex flex-col">`);

code = code.replace(/<div className=\{cn\("glass-panel transition-colors duration-500 rounded-3xl flex flex-col overflow-hidden"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl flex flex-col overflow-hidden">`);

code = code.replace(/<div className=\{cn\("glass-panel transition-colors duration-500 p-5 rounded-3xl flex justify-between items-center"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} className="p-5 rounded-3xl flex justify-between items-center">`);

code = code.replace(/<div key=\{cli\.mac\} className=\{cn\("glass-panel transition-colors duration-500 rounded-2xl p-4"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} key={cli.mac} className="rounded-2xl p-4">`);

code = code.replace(/<div className=\{cn\("glass-panel transition-colors duration-500 rounded-3xl p-5 space-y-6"\)\}>/g, 
  `<GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 space-y-6">`);

// And the one big gravity panel
code = code.replace(/<div className=\{cn\("bg-white\/95 dark:bg-black\/60 dark:backdrop-blur-3xl border border-black\/10 dark:border-\[var\(--glass-border-color\)\] transition-colors duration-500 rounded-3xl p-5 h-\[400px\] flex flex-col relative overflow-hidden shadow-xl shadow-black\/5 dark:shadow-\[0_8px_32px_rgba\(0,0,0,0\.4\),var\(--glass-glow\)\]"\)\}>/,
  `<GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 h-[400px] flex flex-col overflow-hidden shadow-xl">`);

fs.writeFileSync('src/components/MobileDashboard.tsx', code);
