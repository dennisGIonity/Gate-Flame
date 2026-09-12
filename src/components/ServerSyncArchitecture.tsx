import React, { useState } from 'react';
import { IonityUserAccount, HardwareTierId } from '../types';
import { HARDWARE_TIERS } from '../data/productCatalog';
import { 
  Server, Smartphone, Cpu, RefreshCw, Lock, Zap, ArrowRightLeft, ShieldCheck, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

import { useAppStore } from "../store/useAppStore";
import { gateflameApi } from '../services/gateflameApi';

interface ServerSyncArchitectureProps {
  userAccount: IonityUserAccount;
  onUpdateUserAccount: (updated: Partial<IonityUserAccount>) => void;
}

/**
 * Gate^Flame — this screen used to lie in three separate places.
 *
 * Fixed 2026-09-12. All three had survived the 2026-09-10 "remove every
 * simulated data path" sweep, which deleted `mockData.ts` and `mockAdapter.ts`
 * but never reached this component. Recorded here so they are not reintroduced:
 *
 *  1. A button minted `gf_live_ionity_${Math.random()...}` into a field
 *     labelled "API Token". A random string wearing a production-credential
 *     prefix. First flagged 2026-08-18, three times in total. Removed — the
 *     field now shows the real token or an honest "Not issued".
 *
 *  2. `handleTestApiCall` slept 1200 ms and then rendered a fabricated success
 *     payload — "38,851 queries", "14,397 ads blocked", "37.1%", "6,755,558
 *     domains" — in green, as though a real API had answered. It now calls the
 *     node for real via `gateflameApi.telemetry()`. Offline that returns nulls,
 *     which is the honest answer and the whole point.
 *
 *  3. The displayed URL was `http://192.168.1.105/admin/api.php?summary&auth=<token>`
 *     — the wrong /24 entirely (the box has always been on 192.168.0.x), and it
 *     put a bearer credential in a query string. Now the real route, no
 *     credential in the URL.
 *
 * `src/services/noFabricatedCredentials.test.ts` fails if (1) comes back.
 *
 * Still outstanding, and a product call rather than a technical one: the
 * surrounding panels (the "api.ionity.today/v1/sync" endpoint, the R45/mo
 * subscription, the warranty date) are AI-Studio-era brochure furniture. The
 * recorded decision — roadmap Sprint 5.2 — is to delete this screen from the
 * shipping app or gate it behind a /demo route. That has not been done.
 */
export const ServerSyncArchitecture: React.FC = () => {
  const { userAccount, telemetry } = useAppStore();
  const [selectedTierId, setSelectedTierId] = useState<HardwareTierId>('tier3_visual');
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiResponseJson, setApiResponseJson] = useState<string | null>(null);

  /**
   * A real request to the real node. No timer, no invented numbers.
   * `gateflameApi.telemetry` already returns an all-null summary when there is
   * no node, so the offline path needs no special case here — it renders the
   * nulls, and nulls are the truth.
   */
  const handleTestApiCall = async () => {
    setIsTestingApi(true);
    setApiResponseJson(null);
    try {
      const summary = await gateflameApi.telemetry(telemetry);
      setApiResponseJson(JSON.stringify(summary, null, 2));
    } catch (err) {
      setApiResponseJson(JSON.stringify({
        error: 'request_failed',
        detail: err instanceof Error ? err.message : String(err),
        note: 'No measurement was taken. This is the request failing, not the node reporting zero.',
      }, null, 2));
    } finally {
      setIsTestingApi(false);
    }
  };

  const selectedTier = HARDWARE_TIERS.find((t) => t.id === selectedTierId) || HARDWARE_TIERS[2];

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
        <div>
          <h1 className="text-4xl font-display font-light text-white tracking-tight mb-2">
            Server <span className="font-bold">Sync</span>
          </h1>
          <p className="text-sm font-mono text-slate-400">
            Zero-Trust mTLS Pipeline between Mobile, Cloud & Node
          </p>
        </div>
        <div className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400 uppercase">State</span>
          <span className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Synced
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Architecture Diagram */}
        <div className="lg:col-span-3 glass-panel rounded-3xl p-6 md:p-8">
          <h3 className="text-lg font-display font-medium text-white mb-6 flex items-center gap-2">
            <Zap className="w-5 h-5 text-sky-400" /> Distributed Pipeline Architecture
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-4 relative overflow-hidden group hover:border-sky-500/30 transition-colors">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Smartphone className="w-24 h-24" />
              </div>
              <div className="flex justify-between items-center relative z-10">
                <h4 className="text-sm font-display font-bold text-sky-400">Mobile Client</h4>
                <span className="px-2 py-1 bg-white/5 rounded text-[10px] font-mono text-slate-400">APK</span>
              </div>
              <p className="text-xs font-mono text-slate-400 relative z-10">
                Live telemetry visualization and remote pause/whitelist commands execution environment.
              </p>
              <div className="pt-4 border-t border-white/5 text-[10px] font-mono text-slate-500">
                Token: {userAccount.apiKey.slice(0, 12)}...
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-4 relative overflow-hidden group hover:border-indigo-500/30 transition-colors">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Server className="w-24 h-24" />
              </div>
              <div className="flex justify-between items-center relative z-10">
                <h4 className="text-sm font-display font-bold text-indigo-400">Ionity Cloud</h4>
                <span className="px-2 py-1 bg-white/5 rounded text-[10px] font-mono text-slate-400">Bridge</span>
              </div>
              <p className="text-xs font-mono text-slate-400 relative z-10">
                Validates warranty subscriptions, pushes Gravity updates, orchestrates secure mTLS tunnels.
              </p>
              <div className="pt-4 border-t border-white/5 text-[10px] font-mono text-slate-500">
                Endpoint: api.ionity.today/v1/sync
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-4 relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Cpu className="w-24 h-24" />
              </div>
              <div className="flex justify-between items-center relative z-10">
                <h4 className="text-sm font-display font-bold text-emerald-400">Physical Node</h4>
                <span className="px-2 py-1 bg-white/5 rounded text-[10px] font-mono text-slate-400">Edge</span>
              </div>
              <p className="text-xs font-mono text-slate-400 relative z-10">
                Local Pi-hole + Unbound recursion engine. Operates autopilot failover routing on drop.
              </p>
              <div className="pt-4 border-t border-white/5 text-[10px] font-mono text-slate-500">
                MAC: {userAccount.linkedDeviceMac}
              </div>
            </div>
          </div>
        </div>

        {/* Auth & Maintenance */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-panel rounded-3xl p-6">
            <h3 className="text-lg font-display font-medium text-white mb-6">Authentication</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-1">Account Owner</label>
                <div className="text-sm font-medium text-white">{userAccount.email}</div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-1">Linked Device</label>
                <div className="text-sm font-medium text-white">{userAccount.deviceNickname}</div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-2">API Token</label>
                {userAccount.apiKey ? (
                  <input
                    type="text"
                    readOnly
                    value={userAccount.apiKey}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-sky-400 font-mono text-xs focus:outline-none"
                  />
                ) : (
                  <div className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 font-mono text-xs text-slate-500">
                    — Not issued
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-6 bg-emerald-500/5 border-emerald-500/20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-display font-medium text-emerald-400">Subscription</h3>
              <span className="px-3 py-1 bg-emerald-500 text-black text-xs font-bold rounded-full">R45/mo</span>
            </div>
            <p className="text-xs font-mono text-slate-300 leading-relaxed mb-4">
              Active plan includes weekly AI Gravity blocklist updates and 2-Year Hardware Replacement Warranty.
            </p>
            <div className="text-[10px] font-mono text-emerald-400/80 border-t border-emerald-500/20 pt-4">
              Valid Until: {userAccount.warrantyValidUntil}
            </div>
          </div>
        </div>

        {/* API Tester & Hardware matrix */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel rounded-3xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-lg font-display font-medium text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-sky-400" /> API Diagnostic
              </h3>
              <button
                onClick={handleTestApiCall}
                disabled={isTestingApi}
                className="bg-sky-500 hover:bg-sky-400 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={cn("w-4 h-4", isTestingApi && "animate-spin")} />
                {isTestingApi ? 'Executing...' : 'Test GET /summary'}
              </button>
            </div>
            
            <div className="bg-black/50 border border-white/10 rounded-2xl p-4 font-mono text-xs overflow-hidden">
              <div className="text-slate-500 mb-4 pb-4 border-b border-white/5 break-all">
                URL: <span className="text-sky-400">GET /api/v1/telemetry/summary</span>
                <span className="block mt-1 text-slate-600">
                  on the discovered node. Bearer token in the header, never in the URL.
                </span>
              </div>
              
              <AnimatePresence mode="wait">
                {apiResponseJson ? (
                  <motion.pre
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-emerald-400 leading-relaxed overflow-x-auto text-[11px]"
                  >
                    {apiResponseJson}
                  </motion.pre>
                ) : (
                  <div className="text-slate-600 italic py-4 text-center">Run diagnostic to view payload</div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-6">
            <h3 className="text-lg font-display font-medium text-white mb-6">Hardware Tier Specs</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {HARDWARE_TIERS.map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => setSelectedTierId(tier.id)}
                  className={cn(
                    "text-left p-4 rounded-2xl border transition-all relative overflow-hidden group",
                    selectedTierId === tier.id
                      ? "bg-sky-500/10 border-sky-500/50"
                      : "bg-white/5 border-white/10 hover:border-white/20"
                  )}
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className="px-2 py-0.5 rounded bg-black text-[9px] font-mono text-slate-300 border border-white/10">
                      {tier.id.toUpperCase()}
                    </span>
                    <span className="text-sky-400 font-bold text-xs font-mono">R{tier.retailPriceZAR}</span>
                  </div>
                  
                  <div className="font-display font-bold text-white text-sm mb-1">{tier.name}</div>
                  <div className="text-[10px] font-mono text-slate-400 mb-4 line-clamp-2">{tier.subtitle}</div>
                  
                  <div className="space-y-1 text-[10px] font-mono text-slate-500 pt-3 border-t border-white/5">
                    <div className="flex justify-between"><span className="text-slate-600">CPU</span> <span className="text-slate-300">{tier.cpu.split('@')[0]}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">QPS</span> <span className="text-slate-300">{tier.qps}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">Max CL</span> <span className="text-slate-300">{tier.maxClients}</span></div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
