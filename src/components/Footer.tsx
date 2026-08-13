/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Footer Component
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React from 'react';
import { Lock, ExternalLink, ShieldCheck } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-slate-950 border-t border-slate-800 text-slate-400 py-8 px-4 font-sans text-xs mt-12">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold shadow-sm">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm tracking-tight font-sans">
                IONITY GLOBAL (Pty) Ltd
              </h3>
              <p className="text-[10px] text-slate-500 font-medium">
                Gate^Flame™ Network Security & Privacy Node &bull; Registered System Document POL 986 AED
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-sans font-medium">
            <a
              href="https://ionity.co.za/"
              target="_blank"
              rel="noreferrer"
              className="text-sky-500 hover:text-sky-400 flex items-center gap-1 transition-colors"
            >
              ionity.co.za <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://www.ionity.today/"
              target="_blank"
              rel="noreferrer"
              className="text-amber-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
            >
              ionity.today <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] text-slate-400 font-medium leading-relaxed">
          <div>
            <div className="text-slate-200 font-bold mb-1.5 flex items-center gap-1 uppercase tracking-wider text-[10px]">
              <Lock className="w-3 h-3 text-sky-500" /> Legal Marks & Trademark Notice
            </div>
            <p>
              This commercial product and interface software contains legally eligible marks and registered brand names including Ionity Global (Pty) Ltd and Gate^Flame™. Operating under Zero Trust architecture with Unbound DNS recursion.
            </p>
          </div>

          <div>
            <div className="text-white font-bold mb-1.5">
              Managed Subscription & Warranty
            </div>
            <p>
              Subscription rate: R45.00 / month activates weekly Gravity blocklist updates (6.7M+ domains) and 2-Year Full Hardware Warranty. Operates locally on your network without data harvesting.
            </p>
          </div>

          <div>
            <div className="text-white font-bold mb-1.5">
              Contact & Support
            </div>
            <p>
              Manufacturer: Ionity (Pty) Ltd<br />
              Email: ai@ionity.today<br />
              Web: www.ionity.today | www.ionity.co.za
            </p>
          </div>
        </div>

        <div className="text-center text-[10px] text-gray-500 pt-4 border-t border-gray-800/60">
          &copy; 2026 IONITY GLOBAL (Pty) Ltd. Confidential & Proprietary. All Rights Reserved.
        </div>
      </div>
    </footer>
  );
};
