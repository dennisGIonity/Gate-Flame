/* ========================================================================================
 * IONIBOT - PUBLIC SURFACE
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ======================================================================================*/

export { Ionibot, default } from './Ionibot';
export type { IonibotProps } from './Ionibot';

export { TREE } from './tree';
export { runProbes, defaultDeps, SWEEP_BUDGET_MS, listenerFromNetcheck } from './probes';
export type { ProbeDeps } from './probes';
export { resolveState, isInBypass, routerForwarding, ipv6Broken, orderedFailures, FIX_ORDER } from './resolveState';
export { runAction } from './actions';
export type { ActionDeps, ActionOutcome } from './actions';
export { fill } from './render';

export type {
  ActionKind, LocalContext, NetcheckPayload, NetcheckResult, ProbeReport, ProbeResult,
  RenderVars, Screen, ScreenAction, ScreenId, StateId, Tone, Tree,
} from './types';
