/* ========================================================================================
 * IONIBOT - TYPES
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * Ionibot is a live instruction manual embedded in the Gate^Flame mobile app.
 * It is a deterministic tree over five local probes. No model, no cloud, no backend.
 *
 * Everything in this file is data description. Nothing here performs I/O.
 * ====================================================================================== */

/** The seven states the diagnostic engine can resolve to. See resolveState.ts. */
export type StateId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

/** Result of one probe. `unknown` means it was not evaluated (short-circuited) or timed out. */
export type ProbeResult = 'pass' | 'fail' | 'unknown';

export interface ProbeReport {
  /** A1 - handset is on Wi-Fi, not mobile data. */
  wifi: ProbeResult;
  /** A2 - internet path exists with name resolution taken out of the question. */
  rawIp: ProbeResult;
  /** A3 - name resolution works through whatever resolver this handset was handed. */
  dns: ProbeResult;
  /** A4 - the node agent is alive and reachable from this handset. */
  node: ProbeResult;
  /** A5 - the household-facing resolver on the box answers. Derived from netcheck. */
  listener: ProbeResult;
  /** Raw netcheck payload when A5 was obtainable. Rendered, never re-derived. */
  netcheck: NetcheckPayload | null;
  /** Wall-clock milliseconds the whole sweep took. For the progress UI only. */
  elapsedMs: number;
}

/** Mirrors gateflame-netcheck.sh --json. Rendered as-is; Ionibot never recomputes it. */
export interface NetcheckPayload {
  fails: number;
  warns: number;
  lan_ip: string;
  gateway: string;
  results: NetcheckResult[];
}

export interface NetcheckResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  /** Stable check id: addr, dualhome, loopback, lanlistener, otheraddr,
   *  filtering, recursion, router, ipv6, ratelimit, bypass, watchdog. */
  check: string;
  message: string;
}

/**
 * Everything Ionibot knows about this installation, cached locally so that every
 * screen renders with the handset fully offline. Populated at pairing time.
 *
 * The gateway address is stored rather than probed because reading it live needs a
 * native plugin. The agent already knows it, so it is captured once and kept.
 */
export interface LocalContext {
  nodeIp: string | null;
  gateway: string | null;
  /** Set once the router handshake has verifiably taken. Drives IB-605's warning. */
  routerChanged: boolean;
  /** Router model if the handshake recognised it, else null -> guided flow only. */
  routerModel: string | null;
  paired: boolean;
}

/** What an action does when tapped. Handlers live in actions.ts. */
export type ActionKind =
  | 'goto'
  | 'back'
  | 'close'
  | 'rerunDiagnosis'
  | 'openWifiSettings'
  | 'openRouterAdmin'
  | 'startPairing'
  | 'restartResolver'
  | 'pause'
  | 'resume'
  | 'allowSite'
  | 'disableCategory'
  | 'revertRouterAndRemove'
  | 'contactSupport';

export interface ScreenAction {
  label: string;
  kind: ActionKind;
  /** Target screen for kind:'goto', and the screen to land on after a side effect. */
  go?: ScreenId;
  /** Free parameter for the handler, e.g. pause duration in minutes. */
  arg?: string | number;
  /** Visual weight. 'primary' renders filled; at most one per screen. */
  weight?: 'primary' | 'secondary' | 'danger';
}

export type ScreenId = string;

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

export interface Screen {
  id: ScreenId;
  title: string;
  /** Paragraphs. Placeholders {{gateway}} {{nodeIp}} {{site}} {{time}} {{list}}
   *  {{category}} {{categoryBreaks}} are substituted at render time. */
  body?: string[];
  /** Numbered steps. One action per step - never two instructions in one line. */
  steps?: string[];
  actions: ScreenAction[];
  tone?: Tone;
  /** Run the probe sweep on entry and route by resolved state. */
  diagnoseOnEnter?: boolean;
  /** Render the netcheck panel below the body. */
  renderNetcheck?: boolean;
  /**
   * TRUE where the copy on this screen only exists because the box makes a
   * permanent change to the router that only the living box can undo.
   * Under DOC-2026-08-002 Part 5 Option 2 these screens change or disappear.
   * Marked in the data so the rewrite is a filter, not an archaeology exercise.
   */
  architectureDependent?: boolean;
}

export interface Tree {
  version: string;
  /** Pinned against the agent's netcheck contract. A mismatch is a failing test. */
  netcheckContract: string;
  root: ScreenId;
  /** State -> screen. Every StateId must be present; asserted by tests. */
  stateScreens: Record<StateId, ScreenId>;
  screens: Record<ScreenId, Screen>;
}

/** Substitution values available to the renderer. */
export interface RenderVars {
  gateway?: string;
  nodeIp?: string;
  site?: string;
  time?: string;
  list?: string;
  category?: string;
  categoryBreaks?: string;
  contact?: string;
}
