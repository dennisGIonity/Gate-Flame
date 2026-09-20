import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ThreatLogEntry } from '../types';

export const useGateFlameEngine = () => {
  const { telemetry, setTelemetry, setThreatLogs, userAccount } = useAppStore();

  useEffect(() => {
    const interval = setInterval(async () => {
      if (telemetry.protectionStatus !== 'active') return;

      try {
        const baseUrl = userAccount?.nodeIpAddress ? userAccount.nodeIpAddress.replace(/\/$/, '') : 'http://localhost:3001';
        const [piholeRes, eventsRes] = await Promise.all([
          fetch(`${baseUrl}/api/pihole/metrics`).catch(() => fetch('/api/pihole/metrics')),
          fetch(`${baseUrl}/api/security/events`).catch(() => fetch('/api/security/events'))
        ]);

        if (piholeRes?.ok && eventsRes?.ok) {
          const piholeData = await piholeRes.json();
          const eventsData = await eventsRes.json();

          setTelemetry((prev) => ({
            ...prev,
            totalQueriesToday: piholeData.dns_queries_today ? Number(String(piholeData.dns_queries_today).replace(/,/g, '')) : prev.totalQueriesToday,
            queriesBlockedToday: piholeData.ads_blocked_today ? Number(String(piholeData.ads_blocked_today).replace(/,/g, '')) : prev.queriesBlockedToday,
            blockPercentage: piholeData.ads_percentage_today ? Number(piholeData.ads_percentage_today) : prev.blockPercentage,
          }));

          if (eventsData.events && eventsData.events.length > 0) {
            const newLogs: ThreatLogEntry[] = eventsData.events.map((ev: any) => ({
              id: ev.id,
              timestamp: ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date().toLocaleTimeString(),
              domain: ev.dest_ip || 'Unknown',
              clientIp: ev.src_ip || 'Unknown',
              clientName: ev.source || 'Unknown',
              category: 'Telemetry',
              action: ev.severity === 1 ? 'Blocked' : 'Detected',
              severity: ev.severity === 1 ? 'high' : 'medium'
            }));

            setThreatLogs((prev) => {
              const merged = [...newLogs, ...prev];
              const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
              return unique.slice(0, 20);
            });
          }
          return; // Successfully polled, skip simulation
        }
      } catch (error) {
        console.warn('API unavailable, falling back to simulated engine data', error);
      }

      const increment = Math.floor(Math.random() * 4) + 1;
      let blockedIncrement = 0;
      let blockProbability = 0;

      switch (telemetry.filterLevel) {
        case 'none':
          blockProbability = 0;
          break;
        case 'low':
          blockProbability = 0.15;
          break;
        case 'medium':
          blockProbability = 0.37;
          break;
        case 'high':
          blockProbability = 0.60;
          break;
        default:
          blockProbability = 0.37;
      }

      if (Math.random() < blockProbability) {
        blockedIncrement = 1;
      }

      setTelemetry((prev) => {
        const newTotal = prev.totalQueriesToday + increment;
        const newBlocked = prev.queriesBlockedToday + blockedIncrement;
        const newPercentage = Number(((newBlocked / newTotal) * 100).toFixed(1));
        const newSavedMB = Number((prev.dataSavedMB + (blockedIncrement * 0.12)).toFixed(1));

        return {
          ...prev,
          totalQueriesToday: newTotal,
          queriesBlockedToday: newBlocked,
          blockPercentage: newPercentage,
          dataSavedMB: newSavedMB,
        };
      });

      if (blockedIncrement > 0) {
        const sampleDomains = [
          'telemetry.smart-tv.samsungcloud.com',
          'trackers.ads-network.io',
          'analytics.windows-telemetry.com',
          'beacon.evil-domain-phishing.xyz',
          'adservice.google.com/pagead',
          'crypto-miner.pool-hash.top',
        ];
        const sampleClients = [
          'Living Room Smart TV 75"',
          'Dennis-MacBook-Pro',
          'Office-Workstation-04',
          'Guest-Android-Phone',
        ];
        const categories: ThreatLogEntry['category'][] = [
          'Telemetry', 'Ad Tracker', 'Phishing', 'Cryptojacking', 'Adult / Gambling'
        ];

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const newLog: ThreatLogEntry = {
          id: `log-${Date.now()}`,
          timestamp: timeStr,
          domain: sampleDomains[Math.floor(Math.random() * sampleDomains.length)],
          clientIp: '192.168.1.112',
          clientName: sampleClients[Math.floor(Math.random() * sampleClients.length)],
          category: categories[Math.floor(Math.random() * categories.length)],
          action: 'Blocked',
          severity: telemetry.filterLevel === 'high' ? 'high' : (Math.random() > 0.5 ? 'high' : 'medium'),
        };
        
        setThreatLogs((prev) => [newLog, ...prev.slice(0, 19)]);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [telemetry.protectionStatus, telemetry.filterLevel, setTelemetry, setThreatLogs]);
};
