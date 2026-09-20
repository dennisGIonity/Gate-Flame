const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

const ripple = `
                            {/* Ripple Effect on click */}
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={telemetry.filterLevel}
                                    initial={{ scale: 0.8, opacity: 0.5 }}
                                    animate={{ scale: 1.5, opacity: 0 }}
                                    transition={{ duration: 0.5, ease: "easeOut" }}
                                    className={cn("absolute inset-0 rounded-full", getFilterColor(telemetry.filterLevel))}
                                    style={{ backgroundColor: 'currentColor' }}
                                />
                            </AnimatePresence>
`;

code = code.replace(
  /\{(\/\* Layer 1: Very subtle background shield \*\/)\}/,
  ripple + "\n                            {$1}"
);

fs.writeFileSync('src/components/MobileDashboard.tsx', code);
