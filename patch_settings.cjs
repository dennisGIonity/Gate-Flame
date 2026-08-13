const fs = require('fs');
let content = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

const replacement = `                            )}
                            </div>
                            <div className="h-px w-full bg-sky-100 dark:bg-white/5" />
                            
                            {/* Service Manager */}
                            <div>
                                <h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Service Manager</h3>
                                <div className="space-y-3">
                                    {SECURITY_MODULES.map(module => {
                                        const isActive = activeModules.includes(module.id);
                                        const isToggling = togglingModules[module.id];
                                        return (
                                            <div key={module.id} className="bg-sky-50 dark:bg-black/40 border border-sky-100 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden group">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 w-3/4 leading-tight">{module.title}</div>
                                                    <button
                                                        onClick={() => handleToggleModule(module.id, !isActive)}
                                                        disabled={isToggling}
                                                        className={cn(
                                                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                                                            isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700",
                                                            isToggling && "opacity-50 cursor-not-allowed"
                                                        )}
                                                    >
                                                        <span className={cn(
                                                            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                                            isActive ? "translate-x-4" : "translate-x-0"
                                                        )} />
                                                    </button>
                                                </div>
                                                <p className="text-[9px] font-sans text-slate-500 dark:text-slate-400 leading-relaxed transition-colors">
                                                    {module.description}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="h-px w-full bg-sky-100 dark:bg-white/5" />
                            <div>
                            <h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Whitelist</h3>`;

content = content.replace(/                            \)}\s*<\/div>\s*<div className="h-px w-full bg-sky-100 dark:bg-white\/5" \/>\s*<div>\s*<h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Whitelist<\/h3>/, replacement);
fs.writeFileSync('src/components/MobileDashboard.tsx', content);
