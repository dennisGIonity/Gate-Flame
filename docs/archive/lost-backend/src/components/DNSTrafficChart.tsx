import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartData {
  time: string;
  total: number;
  blocked: number;
}

interface DNSTrafficChartProps {
  data: ChartData[];
  theme: 'light' | 'dark' | 'system';
}

export const DNSTrafficChart: React.FC<DNSTrafficChartProps> = React.memo(({ data, theme }) => {
  const isDark = useMemo(() => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, [theme]);

  const tooltipStyle = isDark 
    ? { backgroundColor: '#0a0a0a', borderColor: '#262626', borderRadius: '12px', fontSize: '10px', color: '#fff', padding: '8px' }
    : { backgroundColor: '#ffffff', borderColor: '#e5e7eb', borderRadius: '12px', fontSize: '10px', color: '#0f172a', padding: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' };

  return (
    <ResponsiveContainer width="100%" height="100%" key={theme}>
      <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="totalColorMob" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="blockedColorMob" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="time" stroke={isDark ? "#404040" : "#94a3b8"} fontSize={9} tickLine={false} axisLine={false} />
        <YAxis stroke={isDark ? "#404040" : "#94a3b8"} fontSize={9} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={{ padding: 0 }}
        />
        <Area type="monotone" dataKey="total" stroke="#0ea5e9" strokeWidth={2} fill="url(#totalColorMob)" />
        <Area type="monotone" dataKey="blocked" stroke="#f43f5e" strokeWidth={2} fill="url(#blockedColorMob)" />
      </AreaChart>
    </ResponsiveContainer>
  );
});
