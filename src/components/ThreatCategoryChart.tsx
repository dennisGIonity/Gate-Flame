/**
 * Gate^Flame — threat-vector breakdown chart.
 *
 * Extracted verbatim from MobileDashboard's `threats` tab. It lived inline,
 * which meant MobileDashboard — the one component that is on the critical path
 * to first paint — carried a static `recharts` import, and recharts plus its
 * d3/redux dependency tree is ~415 kB of the bundle. Pulled out here it can be
 * React.lazy()'d, so the dashboard renders without it and the chart arrives
 * when the user actually opens the tab that shows it.
 */

import React from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ThreatCategoryDatum {
  name: string;
  count: number;
  color: string;
}

interface ThreatCategoryChartProps {
  data: ThreatCategoryDatum[];
  theme: 'light' | 'dark' | 'system';
}

export const ThreatCategoryChart: React.FC<ThreatCategoryChartProps> = React.memo(
  ({ data, theme }) => {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    return (
      <ResponsiveContainer key={theme} width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            dataKey="name"
            type="category"
            width={80}
            stroke="#737373"
            fontSize={9}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}
            contentStyle={{
              backgroundColor: isDark ? '#0a0a0a' : '#ffffff',
              borderColor: isDark ? '#262626' : '#e5e7eb',
              borderRadius: '12px',
              fontSize: '10px',
              color: isDark ? '#fff' : '#0f172a',
              padding: '6px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  },
);
