/* ========================================================================================
 * IONIBOT - RENDER HELPERS
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 * Pure string work, kept out of the component so it can be tested without React.
 * ====================================================================================== */

import type { RenderVars } from './types';

/**
 * Substitute {{placeholders}}.
 *
 * An unknown or absent key renders as an empty string, NEVER as the text "undefined".
 * A customer reading "Open your router settings: undefined" has been handed a fault
 * report instead of an instruction, and will phone someone.
 */
export function fill(text: string, vars: RenderVars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = (vars as Record<string, string | undefined>)[k];
    return v ?? '';
  });
}
