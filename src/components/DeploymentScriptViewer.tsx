/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Deployment Script Suite & BOM Calculator
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React, { useState } from 'react';
import { 
  SCRIPT_AUTOPILOT, SCRIPT_DEPLOY, SCRIPT_UNBOUND, SCRIPT_PADD, HARDWARE_TIERS 
} from '../data/mockData';
import { Terminal, Copy, Check, Download, Calculator, ShieldCheck, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

export const DeploymentScriptViewer: React.FC = () => {
  const [activeScript, setActiveScript] = useState<'autopilot' | 'deploy' | 'unbound' | 'padd'>('autopilot');
  const [copied, setCopied] = useState(false);

  const getScriptContent = () => {
    switch (activeScript) {
      case 'autopilot': return { name: 'network_autopilot.sh', code: SCRIPT_AUTOPILOT, desc: 'Autonomously detects internet uplink. Launches "PiHole_Config_Setup" failover hotspot if disconnected.' };
      case 'deploy': return { name: 'deploy_pihole.sh', code: SCRIPT_DEPLOY, desc: 'Unattended Pi-hole injector. Dynamically binds Ethernet RJ45 or Wi-Fi interfaces without interactive prompts.' };
      case 'unbound': return { name: 'install_unbound.sh', code: SCRIPT_UNBOUND, desc: 'Recursive DNS resolver. Direct root hints queries, eliminating upstream ISP or Google logging.' };
      case 'padd': return { name: 'install_padd.sh', code: SCRIPT_PADD, desc: 'Pi-hole Ad Detection Display (PADD) terminal kiosk launcher for physical 3.5" or 7" displays.' };
    }
  };

  const scriptObj = getScriptContent();

  const handleCopy = () => {
    navigator.clipboard.writeText(scriptObj.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([scriptObj.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = scriptObj.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
        <div>
          <h1 className="text-4xl font-display font-light text-white tracking-tight mb-2">
            Deployment <span className="font-bold">Scripts</span>
          </h1>
          <p className="text-sm font-mono text-slate-400">
            Production-ready Bash deployment suite & Bill of Materials for Ionity Edge Nodes
          </p>
        </div>
        <div className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
          <span className="text-[11px] font-mono text-sky-400 font-medium tracking-wider uppercase">
            Zero-Trust System Suite v0.1
          </span>
        </div>
      </div>

      {/* Script Tab Selector & Code Viewer */}
      <div className="glass-panel rounded-3xl overflow-hidden font-mono flex flex-col h-[500px]">
        {/* Script Selection Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/5 px-6 py-4 gap-4">
          <div className="flex items-center gap-2 text-xs font-mono font-medium overflow-x-auto no-scrollbar w-full sm:w-auto">
            {(['autopilot', 'deploy', 'unbound', 'padd'] as const).map((scriptId) => (
              <button
                key={scriptId}
                onClick={() => setActiveScript(scriptId)}
                className={cn(
                  "px-4 py-2 rounded-xl transition-all whitespace-nowrap",
                  activeScript === scriptId
                    ? "bg-white text-black font-bold shadow-sm"
                    : "bg-white/5 text-slate-400 border-transparent hover:text-white hover:bg-white/10"
                )}
              >
                {scriptId === 'autopilot' ? 'network_autopilot.sh' : 
                 scriptId === 'deploy' ? 'deploy_pihole.sh' : 
                 scriptId === 'unbound' ? 'install_unbound.sh' : 'install_padd.sh'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 font-mono text-xs font-bold w-full sm:w-auto shrink-0">
            <button
              onClick={handleCopy}
              className="bg-white/5 hover:bg-white/10 text-sky-400 px-4 py-2 rounded-xl border border-white/10 transition-colors flex items-center gap-2 flex-1 sm:flex-none justify-center"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Script'}
            </button>

            <button
              onClick={handleDownload}
              className="bg-sky-500 hover:bg-sky-400 text-black px-4 py-2 rounded-xl transition-colors flex items-center gap-2 flex-1 sm:flex-none justify-center"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>
        </div>

        {/* Script Description Banner */}
        <div className="bg-sky-500/10 p-4 px-6 border-b border-white/5 text-xs text-slate-300 font-mono font-medium">
          <strong className="text-sky-400 uppercase tracking-wider text-[10px] mr-2">Purpose:</strong> {scriptObj.desc}
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-auto p-6 bg-black/40 text-sky-300 text-xs leading-relaxed font-mono no-scrollbar">
          <pre><code>{scriptObj.code}</code></pre>
        </div>
      </div>

      {/* Hardware Bill of Materials (BOM) Calculator */}
      <div className="glass-panel p-8 rounded-3xl space-y-6">
        <h3 className="text-lg font-display font-medium text-white flex items-center gap-2">
          <Calculator className="w-5 h-5 text-emerald-400" /> Bill of Materials (BOM) & Unit Economics (ZAR)
        </h3>

        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-white/10 text-slate-500 text-[10px] uppercase tracking-wider font-mono">
                <th className="py-4 px-4 font-bold">Device Model</th>
                <th className="py-4 px-4 font-bold">Core Compute Platform</th>
                <th className="py-4 px-4 font-bold">Primary Features</th>
                <th className="py-4 px-4 font-bold">Base Hardware Cost</th>
                <th className="py-4 px-4 font-bold text-sky-400">Retail Price (+25% Margin)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm font-medium">
              {HARDWARE_TIERS.map((tier) => (
                <tr key={tier.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-4 text-white font-display">{tier.name.split(':')[1]}</td>
                  <td className="py-4 px-4 text-sky-400 font-mono">{tier.cpu.split('@')[0]}</td>
                  <td className="py-4 px-4 text-slate-400 font-mono text-xs">{tier.display}</td>
                  <td className="py-4 px-4 text-slate-500 font-mono">R{tier.baseCostZAR.toFixed(2)}</td>
                  <td className="py-4 px-4 font-bold text-sky-400 font-mono">R{tier.retailPriceZAR.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
