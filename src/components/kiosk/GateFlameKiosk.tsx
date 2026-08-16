/**
 * src/main-kiosk.tsx
 * 
 * Gate^Flame On-Device Kiosk Display
 * 
 * Single-page React + TypeScript application.
 * Designed for a 1920x1080 display powered by a Raspberry Pi 5.
 * 
 * NOTE ON DATA INTEGRITY:
 * This UI strictly obeys the rule: Never display fabricated data. 
 * `null` values are rendered as `—` (unknown). Empty arrays are given explicit
 * "nothing observed" states. There are no fallback integers or fake generators.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface SystemStatus {
  nodeId: string;
  agentVersion: string;
  provisioned: boolean;
}

export interface HostTelemetry {
  cpuPercent: number | null;
  memUsedMB: number | null;
  memTotalMB: number | null;
  diskUsedPercent: number | null;
  uptimeSeconds: number | null;
  tempC: number | null;
  throttleFlags: string | null;
}

export interface TelemetrySummary {
  totalQueriesToday: number | null;
  queriesBlockedToday: number | null;
  blockPercentage: number | null;
  domainsOnGravity: number | null;
  activeClientsCount: number | null;
  dataSavedMB: number | null;
  avgLatencyMs: number | null;
  uptimeSeconds: number | null;
  host: HostTelemetry | null;
  piholeReachable: boolean;
  gap?: string | null;
}

export interface Client {
  ip: string;
  mac: string;
  hostname: string | null;
  interface: string;
}

export interface ServiceModule {
  id: string;
  label: string;
  status: 'running' | 'stopped' | 'degraded' | 'not_implemented' | 'fault';
  gap?: string | null;
}

export interface ThreatEntry {
  id: string;
  timestamp: string;
  sourceIp: string;
  type: string;
  severity: string;
}

export interface ThreatsResponse {
  entries: ThreatEntry[];
  source: string;
  gap?: string | null;
}

export interface PairResponse {
  code: string;
  expiresAt: string;
  attemptsRemaining: number;
}

// ============================================================================
// API HOOKS & PLUMBING
// ============================================================================

const API_BASE = 'http://localhost:8080/api/v1';

/**
 * Generic polling hook using AbortController to prevent stack-up.
 */
function usePolledEndpoint<T>(endpoint: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    let controller = new AbortController();

    const fetchIt = async () => {
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        
        if (active) {
          setData(json);
          setLastSeen(new Date());
          setError(null);
        }
      } catch (err: any) {
        if (active && err.name !== 'AbortError') {
          setError(err);
        }
      }
    };

    fetchIt();
    const interval = setInterval(() => {
      controller.abort(); // Cancel in-flight request if it's hanging
      controller = new AbortController();
      fetchIt();
    }, intervalMs);

    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [endpoint, intervalMs]);

  return { data, error, lastSeen };
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

/**
 * Handles the "Never display a value the API did not return" rule.
 * Null case handled here: Renders a muted em-dash (`—`) when value is null.
 * Shows `gap` text below if available to explain WHY it is null.
 */
const MetricValue = ({ 
  label, 
  value, 
  suffix = '', 
  gap, 
  highlight = false 
}: { 
  label: string, 
  value: string | number | null, 
  suffix?: string, 
  gap?: string | null,
  highlight?: boolean
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-[#475569] text-xs font-semibold uppercase tracking-widest">{label}</span>
    {value === null ? (
      <div className="flex flex-col">
        <span className="text-3xl font-mono text-[#475569] tabular-nums">—</span>
        {gap && <span className="text-xs text-[#F59E0B] mt-1 font-sans leading-tight">{gap}</span>}
      </div>
    ) : (
      <div className="flex items-baseline gap-1">
        <span className={`text-4xl font-mono tabular-nums tracking-tight ${highlight ? 'text-[#38BDF8]' : 'text-slate-100'}`}>
          {value}
        </span>
        {suffix && <span className="text-lg text-slate-400 font-mono">{suffix}</span>}
      </div>
    )}
  </div>
);

function formatSeconds(seconds: number | null): string | null {
  if (seconds === null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ============================================================================
// MAIN APPLICATION LAYOUT
// ============================================================================

export default function GateFlameKiosk() {
  // Polled state
  const { data: status, error: statusErr, lastSeen: statusSeen } = usePolledEndpoint<SystemStatus>('/system/status', 4000);
  const { data: telemetry, error: telemetryErr, lastSeen: telemetrySeen } = usePolledEndpoint<TelemetrySummary>('/telemetry/summary', 4000);
  const { data: services, error: servicesErr } = usePolledEndpoint<{modules: ServiceModule[]}>('/services', 4000);
  const { data: clients, error: clientsErr } = usePolledEndpoint<{clients: Client[]}>('/clients', 4000);
  const { data: threats, error: threatsErr } = usePolledEndpoint<ThreatsResponse>('/threats/recent?limit=20', 10000);

  const [isPairing, setIsPairing] = useState(false);
  const [pairData, setPairData] = useState<PairResponse | null>(null);
  
  // Aggregate connection state
  const isDisconnected = !!(statusErr || telemetryErr || servicesErr || clientsErr);
  const mostRecentSeen = [statusSeen, telemetrySeen].sort((a, b) => (b?.getTime() || 0) - (a?.getTime() || 0))[0];

  const handlePairRequest = async () => {
    setIsPairing(true);
    try {
      const res = await fetch(`${API_BASE}/pair/request`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to request pairing');
      const data = await res.json();
      setPairData(data);
    } catch (e) {
      console.error(e);
      // Failsafe reset if POST fails
      setIsPairing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#080D16] text-slate-200 font-sans overflow-hidden flex flex-col antialiased">
      {/* Decorative background drift / glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,111,211,0.08)_0%,transparent_70%)] pointer-events-none" />
      
      {/* 1. HEADER */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-[#1E293B] bg-[#111A28]/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#0F1B2D] border border-[#1E293B] flex items-center justify-center">
            {/* Brand icon representation */}
            <svg className="w-6 h-6 text-[#006FD3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-wide flex items-center gap-2">
              GATE<span className="text-[#006FD3]">^</span>FLAME
            </h1>
            <div className="text-xs text-[#475569] font-mono tracking-widest uppercase mt-0.5">
              {/* Null case: if status isn't loaded yet, show skeletal dash */}
              Node {status?.nodeId ?? '—'} • v{status?.agentVersion ?? '—'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <button 
            onClick={handlePairRequest}
            className="px-6 py-2.5 bg-[#006FD3] hover:bg-[#005bb5] transition-colors rounded-lg text-sm font-semibold tracking-wide uppercase text-white shadow-[0_0_20px_rgba(0,111,211,0.3)]"
          >
            Pair a Phone
          </button>
        </div>
      </header>

      {/* DISCONNECTION OVERLAY */}
      {isDisconnected && (
        <div className="absolute inset-0 z-50 bg-[#080D16]/90 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="bg-[#E11D48]/10 border border-[#E11D48] rounded-2xl p-8 flex flex-col items-center max-w-md text-center">
            <div className="w-16 h-16 rounded-full bg-[#E11D48]/20 flex items-center justify-center mb-4 text-[#E11D48]">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-2xl font-semibold text-slate-100 mb-2">Node Unreachable</h2>
            <p className="text-slate-400 mb-6">
              The interface has lost connection to the local agent. 
              Do not trust currently displayed metrics.
            </p>
            <div className="text-sm font-mono text-[#475569] bg-[#111A28] px-4 py-2 rounded-lg">
              Last seen: {mostRecentSeen ? mostRecentSeen.toLocaleTimeString() : 'Unknown'}
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT GRID */}
      <main className="relative z-10 flex-1 grid grid-cols-12 gap-6 p-8 overflow-hidden min-h-0">
        
        {/* LEFT/CENTER COLUMN (Hero + Modules) */}
        <div className="col-span-8 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* 2. HERO PANEL */}
          <section className={`p-8 rounded-2xl border backdrop-blur-md flex flex-col gap-8 transition-colors duration-700
            ${telemetry?.piholeReachable === false 
              ? 'bg-[#F59E0B]/5 border-[#F59E0B]/30' 
              : 'bg-[#111A28]/80 border-[#1E293B]'}`}>
            
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-5xl font-light tracking-tight text-white mb-3">
                  {/* Handle undefined state gracefully before data arrives */}
                  {!telemetry ? (
                    <span className="text-slate-600 animate-pulse">Initializing...</span>
                  ) : telemetry.piholeReachable ? (
                    'Filtering Active'
                  ) : (
                    'Filtering Offline'
                  )}
                </h2>
                {telemetry?.gap && (
                  <p className="text-[#F59E0B] text-sm font-medium tracking-wide flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
                    {telemetry.gap}
                  </p>
                )}
              </div>
              <div className="text-right">
                <MetricValue 
                  label="Uptime" 
                  value={formatSeconds(telemetry?.uptimeSeconds ?? null)} 
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-8 pt-6 border-t border-[#1E293B]/50">
              <MetricValue 
                label="Total Queries" 
                value={telemetry?.totalQueriesToday ?? null} 
              />
              <MetricValue 
                label="Blocked Today" 
                value={telemetry?.queriesBlockedToday ?? null} 
                highlight={true}
              />
              <MetricValue 
                label="Block Rate" 
                value={telemetry?.blockPercentage ?? null} 
                suffix="%" 
              />
            </div>
          </section>

          {/* 3. MODULE GRID */}
          <section className="flex flex-col gap-4 mt-4">
            <h3 className="text-sm font-semibold tracking-widest text-[#475569] uppercase">Security Modules</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Null case: Empty array implies services endpoint returned no modules yet. Handled via map intentionally rendering nothing, or waiting on undefined. */}
              {(!services ? Array.from({length: 4}) : services.modules).map((mod, i) => {
                // Skeleton loading state
                if (!mod || !('id' in mod)) {
                  return <div key={i} className="h-24 bg-[#111A28]/50 border border-[#1E293B] rounded-2xl animate-pulse" />;
                }

                const StatusColor = {
                  running: 'bg-[#10B981] shadow-[0_0_12px_rgba(16,185,129,0.3)]',
                  degraded: 'bg-[#F59E0B]',
                  stopped: 'bg-[#64748B]',
                  fault: 'bg-[#E11D48]',
                  not_implemented: 'bg-[#475569] opacity-30'
                }[mod.status] || 'bg-slate-700';

                return (
                  <div key={mod.id} className="p-5 bg-[#111A28]/80 border border-[#1E293B] rounded-2xl flex flex-col justify-between backdrop-blur-md">
                    <div className="flex items-start justify-between mb-4">
                      <span className="font-medium text-slate-200">{mod.label}</span>
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${StatusColor}`} />
                    </div>
                    {/* Explicitly surface gaps as requested: "When a gap is present it must be visible" */}
                    {mod.gap ? (
                      <div className="text-xs text-[#F59E0B] leading-snug border-l-2 border-[#F59E0B] pl-2 mt-auto">
                        {mod.gap}
                      </div>
                    ) : (
                      <div className="text-xs text-[#475569] uppercase font-mono tracking-wider mt-auto">
                        {mod.status}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* THREATS / EVENTS (Below modules) */}
          <section className="flex flex-col gap-4 mt-4">
            <h3 className="text-sm font-semibold tracking-widest text-[#475569] uppercase">Recent Threats</h3>
            <div className="bg-[#111A28]/80 border border-[#1E293B] rounded-2xl backdrop-blur-md p-6 min-h-[160px] flex flex-col">
              {threats?.gap ? (
                <div className="m-auto text-center text-[#F59E0B] text-sm max-w-md">
                  {threats.gap}
                </div>
              ) : threats?.entries.length === 0 ? (
                // Null case: Deliberate empty state, no fabricated rows
                <div className="m-auto text-center text-[#475569] text-sm">
                  No threats recorded yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {threats?.entries.map(t => (
                    <div key={t.id} className="flex items-center justify-between py-2 border-b border-[#1E293B] last:border-0">
                      <div className="flex items-center gap-4">
                        <span className={`text-xs px-2 py-0.5 rounded uppercase font-mono ${
                          t.severity === 'high' ? 'bg-[#E11D48]/20 text-[#E11D48]' : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                        }`}>
                          {t.severity}
                        </span>
                        <span className="text-sm font-mono text-slate-300">{t.sourceIp}</span>
                      </div>
                      <span className="text-sm text-slate-400">{t.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* 4. RIGHT RAIL (Telemetry & Clients) */}
        <div className="col-span-4 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* HOST TELEMETRY */}
          <section className="bg-[#111A28]/80 border border-[#1E293B] rounded-2xl p-6 backdrop-blur-md flex flex-col gap-6">
            <h3 className="text-sm font-semibold tracking-widest text-[#475569] uppercase border-b border-[#1E293B] pb-4">
              Host Telemetry
            </h3>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <MetricValue 
                label="CPU Usage" 
                value={telemetry?.host?.cpuPercent ?? null} 
                suffix="%" 
              />
              <MetricValue 
                label="Temp" 
                value={telemetry?.host?.tempC ?? null} 
                suffix="°C" 
              />
              
              <div className="col-span-2">
                <MetricValue 
                  label="Memory" 
                  value={telemetry?.host?.memUsedMB && telemetry?.host?.memTotalMB 
                    ? `${telemetry.host.memUsedMB}` 
                    : null
                  } 
                  suffix={telemetry?.host?.memTotalMB ? `/ ${telemetry.host.memTotalMB} MB` : undefined}
                />
              </div>

              <MetricValue 
                label="Disk I/O" 
                value={telemetry?.host?.diskUsedPercent ?? null} 
                suffix="%" 
              />
              <MetricValue 
                label="Throttle" 
                value={telemetry?.host?.throttleFlags ?? null} 
              />
            </div>
          </section>

          {/* CONNECTED CLIENTS */}
          <section className="bg-[#111A28]/80 border border-[#1E293B] rounded-2xl flex-1 flex flex-col min-h-0 backdrop-blur-md">
            <div className="p-6 border-b border-[#1E293B] flex flex-col gap-5 shrink-0">
              <MetricValue 
                label="Active DNS Clients" 
                value={telemetry?.activeClientsCount ?? null} 
                gap={telemetry?.gap}
              />
              <div className="flex items-center justify-between pt-1">
                <h3 className="text-sm font-semibold tracking-widest text-[#475569] uppercase">
                  Devices seen on LAN
                </h3>
                <span className="text-xl font-mono text-[#38BDF8] tabular-nums">
                  {clients ? clients.clients.length : '—'}
                </span>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              {/* Null case: empty array implies nothing observed. Render deliberate text. */}
              {clients?.clients.length === 0 ? (
                <div className="text-center text-[#475569] text-sm mt-8">
                  No active clients observed.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {clients?.clients.map(c => (
                    <div key={c.mac} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm text-slate-200">{c.ip}</span>
                        <span className="text-xs text-[#475569] font-mono">{c.interface}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[#475569] uppercase">{c.mac}</span>
                        {/* Render hostname only if API provided it, else nothing. Never invent a vendor name. */}
                        {c.hostname && (
                          <span className="text-xs text-slate-500 truncate">{c.hostname}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 px-8 py-4 border-t border-[#1E293B] bg-[#080D16] shrink-0 text-center">
        <p className="text-[10px] text-[#475569] font-mono uppercase tracking-[0.3em]">
          IONITY GATE^FLAME NODE // {status?.nodeId ?? 'INITIALIZING...'}
        </p>
      </footer>

      {/* PAIRING OVERLAY (Z-Index highest) */}
      {isPairing && <PairingOverlay pairData={pairData} onClose={() => setIsPairing(false)} />}
      
    </div>
  );
}

// ============================================================================
// PAIRING OVERLAY COMPONENT
// ============================================================================

function PairingOverlay({ pairData, onClose }: { pairData: PairResponse | null, onClose: () => void }) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!pairData?.expiresAt) return;
    
    const target = new Date(pairData.expiresAt).getTime();
    
    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = Math.max(0, Math.floor((target - now) / 1000));
      setTimeLeft(diff);
      if (diff === 0) {
        setTimeout(onClose, 2000); // Auto close after 2s of 0
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [pairData, onClose]);

  return (
    <div className="absolute inset-0 z-50 bg-[#080D16]/90 backdrop-blur-xl flex flex-col items-center justify-center">
      <button 
        onClick={onClose}
        className="absolute top-8 right-8 text-slate-500 hover:text-white transition-colors"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="text-center flex flex-col items-center max-w-2xl">
        <h2 className="text-2xl font-light text-[#475569] tracking-widest uppercase mb-8">
          Enter this code in the Ionity app
        </h2>
        
        {/* Null case: Skeleton while waiting for POST to resolve */}
        {!pairData ? (
          <div className="h-32 w-96 bg-[#111A28] border border-[#1E293B] rounded-2xl animate-pulse mb-8" />
        ) : (
          <div className="text-9xl font-mono tracking-[0.1em] text-white tabular-nums drop-shadow-[0_0_40px_rgba(56,189,248,0.4)] mb-8 font-light">
            {pairData.code}
          </div>
        )}

        <div className="flex items-center gap-8 text-sm font-mono text-[#475569]">
          <div className="flex items-center gap-2">
            <span className={timeLeft <= 30 ? 'text-[#FF8700]' : 'text-[#38BDF8]'}>
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </span>
            <span>REMAINING</span>
          </div>
          <div>•</div>
          <div>
            <span className="text-slate-300">{pairData?.attemptsRemaining ?? '—'}</span> ATTEMPTS
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STYLES 
// Note: Put this in your global css or index.css for custom scrollbar aesthetics
// ============================================================================
/*
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #1E293B;
  border-radius: 20px;
}
*/