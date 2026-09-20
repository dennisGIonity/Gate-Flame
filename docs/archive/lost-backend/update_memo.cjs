const fs = require('fs');
let code = fs.readFileSync('src/components/MobileDashboard.tsx', 'utf8');

// replace React import to include useMemo
code = code.replace(
  /import React, \{ useState \} from 'react';/,
  "import React, { useState, useMemo } from 'react';"
);

code = code.replace(
  /const chartData = \[\s*\{\s*time: '00:00'.*[\s\S]*?\];/m,
  "const chartData = useMemo(() => [\n    { time: '00:00', total: 1200, blocked: 450 },\n    { time: '04:00', total: 800, blocked: 310 },\n    { time: '08:00', total: 2400, blocked: 910 },\n    { time: '12:00', total: 6800, blocked: 2520 },\n    { time: '16:00', total: 9500, blocked: 3510 },\n    { time: '20:00', total: 8200, blocked: 3040 },\n    { time: '24:00', total: 11200, blocked: 4150 },\n  ], []);"
);

code = code.replace(
  /const categoryBreakdown = \[\s*\{\s*name: 'Ad Trackers'.*[\s\S]*?\];/m,
  "const categoryBreakdown = useMemo(() => [\n    { name: 'Ad Trackers', count: 5820, color: '#0ea5e9' },\n    { name: 'Telemetry', count: 4210, color: '#38bdf8' },\n    { name: 'Malware', count: 2190, color: '#f43f5e' },\n    { name: 'Phishing', count: 1240, color: '#f59e0b' },\n  ], []);"
);

code = code.replace(
  /const filteredLogs = selectedFilterCategory === 'All'\s*\?\s*threatLogs\s*:\s*threatLogs\.filter\(log => log\.category === selectedFilterCategory\);/,
  "const filteredLogs = useMemo(() => {\n    return selectedFilterCategory === 'All'\n      ? threatLogs\n      : threatLogs.filter(log => log.category === selectedFilterCategory);\n  }, [selectedFilterCategory, threatLogs]);"
);

fs.writeFileSync('src/components/MobileDashboard.tsx', code);
