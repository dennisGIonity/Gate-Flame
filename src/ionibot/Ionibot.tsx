/* ========================================================================================
 * IONIBOT - THE SURFACE
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * MOBILE APP ONLY. NOT THE KIOSK.
 *
 * An overlay, never a destination. One floating button, present on every app screen,
 * opening a sheet over whatever the customer was already doing. A tab is somewhere you
 * have to think to go; a customer whose internet has stopped is not exploring an app.
 *
 * Mount ONCE, at the app root, inside whatever router/provider tree already exists:
 *
 *     <Ionibot ctx={localContext} contactUrl="mailto:info@ionity.today" />
 *
 * OFFLINE BY CONSTRUCTION
 * Every string, every screen and every style in this module is bundled. There is no
 * remote import, no web font, no CDN, no image URL. That is not an optimisation - the
 * moment Ionibot is needed most is the moment there is no name resolution, so anything
 * fetched is a blank screen at exactly the wrong time. Enforced by a build-time test.
 *
 * NOTHING LEAVES THE PHONE
 * Probe output lives in component state while the sheet is open and is discarded on
 * close. It is never logged, persisted, or transmitted. This preserves by construction
 * the boundary health_feed.py enforces.
 *
 * STYLING
 * Inline styles and one scoped <style> block, so this module drops into the app with no
 * assumption about Tailwind, a theme provider, or a component library being present.
 * ====================================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runProbes, defaultDeps as defaultProbeDeps, type ProbeDeps } from './probes';
import { isInBypass, orderedFailures, resolveState } from './resolveState';
import { runAction, type ActionDeps } from './actions';
import { fill } from './render';
import { TREE } from './tree';
import type { LocalContext, ProbeReport, RenderVars, Screen, ScreenId } from './types';

export { fill };

/* ------------------------------------------------------------------------- palette */

const C = {
  ink: '#12161c',
  sub: '#5a6472',
  line: '#e2e6ec',
  card: '#ffffff',
  scrim: 'rgba(10,14,20,0.55)',
  flame: '#e2571f',
  good: '#1c8a4a',
  warn: '#b26a00',
  bad: '#c22c22',
} as const;

const TONE = {
  neutral: C.sub,
  good: C.good,
  warn: C.warn,
  bad: C.bad,
} as const;

/* ---------------------------------------------------------------------- properties */

export interface IonibotProps {
  ctx: LocalContext;
  contactUrl: string;
  /** Opens Ionibot at a specific screen when pressed from a known app screen. */
  contextScreen?: ScreenId;
  probeDeps?: ProbeDeps;
  openExternal?: (url: string) => Promise<void>;
  openWifiSettings?: () => Promise<void>;
  startPairing?: () => Promise<void>;
  /** Hide the floating button; drive the sheet yourself via `open`/`onClose`. */
  headless?: boolean;
  open?: boolean;
  onClose?: () => void;
}

/* ====================================================================== component */

export const Ionibot: React.FC<IonibotProps> = ({
  ctx,
  contactUrl,
  contextScreen,
  probeDeps = defaultProbeDeps,
  openExternal = async (url) => { window.open(url, '_system'); },
  openWifiSettings = async () => { window.open('app-settings:', '_system'); },
  startPairing = async () => {},
  headless = false,
  open: controlledOpen,
  onClose,
}) => {
  const [open, setOpen] = useState(false);
  const isOpen = controlledOpen ?? open;

  const [stack, setStack] = useState<ScreenId[]>([TREE.root]);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [site, setSite] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);

  const current: ScreenId = stack[stack.length - 1] ?? TREE.root;
  const screen: Screen = TREE.screens[current] ?? TREE.screens[TREE.root];

  const vars: RenderVars = useMemo(
    () => ({
      gateway: ctx.gateway ?? 'your router address',
      nodeIp: ctx.nodeIp ?? 'your box address',
      site: site || 'that website',
      contact: contactUrl.replace(/^mailto:/, ''),
      time: 'the time shown in the app',
    }),
    [ctx.gateway, ctx.nodeIp, site, contactUrl],
  );

  const push = useCallback((id: ScreenId) => {
    setProblem(null);
    setStack((s) => (TREE.screens[id] ? [...s, id] : s));
  }, []);

  const back = useCallback(() => {
    setProblem(null);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
    // Discard everything. Probe output must not outlive the sheet.
    setStack([contextScreen && TREE.screens[contextScreen] ? contextScreen : TREE.root]);
    setReport(null);
    setProblem(null);
    setSite('');
  }, [onClose, contextScreen]);

  /** Run the sweep and jump straight to the screen for the resolved state. */
  const diagnose = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await runProbes(ctx, probeDeps);
      setReport(r);
      const target = TREE.stateScreens[resolveState(r)];
      setStack((s) => [...s, target]);
    } finally {
      setBusy(false);
    }
  }, [ctx, probeDeps]);

  // Screens flagged diagnoseOnEnter run the sweep as they mount.
  useEffect(() => {
    if (isOpen && screen.diagnoseOnEnter && !busy) void diagnose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, current]);

  // Fetch netcheck for screens that render it but do not re-diagnose.
  useEffect(() => {
    if (isOpen && screen.renderNetcheck && !report && !busy) void diagnose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, current]);

  const actionDeps: ActionDeps = useMemo(
    () => ({
      fetch: probeDeps.fetch,
      ctx,
      openExternal,
      openWifiSettings,
      startPairing,
      site: site || undefined,
      contactUrl,
    }),
    [probeDeps.fetch, ctx, openExternal, openWifiSettings, startPairing, site, contactUrl],
  );

  const onAction = useCallback(
    async (kind: Parameters<typeof runAction>[0], arg?: string | number, go?: ScreenId) => {
      if (kind === 'back') return back();
      setBusy(true);
      setProblem(null);
      try {
        const out = await runAction(kind, arg, go, actionDeps);
        if (out.problem) return setProblem(out.problem);
        if (out.close) return close();
        if (out.rerun) return void diagnose();
        if (out.go) return push(out.go);
      } finally {
        setBusy(false);
      }
    },
    [actionDeps, back, close, diagnose, push],
  );

  // Escape closes; focus moves into the sheet when it opens.
  useEffect(() => {
    if (!isOpen) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const bypass = report ? isInBypass(report) : false;
  const failures = report ? orderedFailures(report) : [];

  /* -------------------------------------------------------------------- rendering */

  if (!isOpen) {
    if (headless) return null;
    return (
      <>
        <IonibotStyles />
        <button
          className="ib-fab"
          onClick={() => setOpen(true)}
          aria-label="Get help with your Gate^Flame"
        >
          <span aria-hidden="true" className="ib-fab-mark">?</span>
          <span className="ib-fab-text">Help</span>
        </button>
      </>
    );
  }

  return (
    <>
      <IonibotStyles />
      <div className="ib-scrim" onClick={close} aria-hidden="true" />
      <div
        className="ib-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Gate^Flame help"
        tabIndex={-1}
        ref={sheetRef}
      >
        <header className="ib-head">
          {stack.length > 1 ? (
            <button className="ib-icon" onClick={back} aria-label="Go back">‹</button>
          ) : (
            <span className="ib-icon ib-icon-blank" aria-hidden="true" />
          )}
          <span className="ib-brand">Ionibot</span>
          <button className="ib-icon" onClick={close} aria-label="Close help">×</button>
        </header>

        {bypass && (
          <p className="ib-banner" role="status">
            Your box is letting everything through at the moment. Nothing is being blocked.
          </p>
        )}

        <div className="ib-body">
          <h2 className="ib-title" style={{ color: TONE[screen.tone ?? 'neutral'] }}>
            {fill(screen.title, vars)}
          </h2>

          {screen.body?.map((p, i) => (
            <p key={i} className="ib-p">{fill(p, vars)}</p>
          ))}

          {screen.steps && (
            <ol className="ib-steps">
              {screen.steps.map((s, i) => <li key={i}>{fill(s, vars)}</li>)}
            </ol>
          )}

          {current === 'IB-301' && (
            <input
              className="ib-input"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="example.co.za"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              aria-label="Website address"
            />
          )}

          {busy && (
            <p className="ib-busy" role="status">
              Checking. This takes about five seconds…
            </p>
          )}

          {problem && <p className="ib-problem" role="alert">{problem}</p>}

          {screen.renderNetcheck && report && (
            <NetcheckPanel failures={failures} report={report} />
          )}
        </div>

        <footer className="ib-actions">
          {screen.actions.map((a, i) => (
            <button
              key={i}
              className={`ib-btn ib-btn-${a.weight ?? 'secondary'}`}
              disabled={busy}
              onClick={() => void onAction(a.kind, a.arg, a.go)}
            >
              {fill(a.label, vars)}
            </button>
          ))}
        </footer>
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ netcheck panel */

/**
 * Renders the box's own findings.
 *
 * Two rules, both load-bearing:
 *  - order is netcheck's fix order, never severity or alphabetical, because each
 *    condition can mask the next;
 *  - a check that could not run says so. It is NEVER drawn as a pass. A clean bill
 *    of health from a blind check is worse than no check, because the customer stops
 *    looking. posture.py splits findings from gaps for the same reason.
 *
 * Status is carried by text as well as colour - nothing here depends on being able to
 * distinguish red from green.
 */
const NetcheckPanel: React.FC<{
  failures: { check: string; message: string }[];
  report: ProbeReport;
}> = ({ failures, report }) => {
  if (!report.netcheck) {
    return (
      <div className="ib-nc">
        <p className="ib-p ib-muted">
          I could not read the full report from your box, so I cannot confirm everything
          is well. This is not the same as saying it is fine.
        </p>
      </div>
    );
  }

  if (failures.length === 0) {
    return (
      <div className="ib-nc">
        <p className="ib-nc-row ib-ok"><b>All clear.</b> Nothing needs your attention.</p>
      </div>
    );
  }

  return (
    <div className="ib-nc">
      <p className="ib-p ib-muted">Fix these in this order. Each one can hide the next.</p>
      <ol className="ib-nc-list">
        {failures.map((f, i) => (
          <li key={f.check} className="ib-nc-row ib-fail">
            <b>{i + 1}. Needs attention —</b> {PLAIN[f.check] ?? f.message}
          </li>
        ))}
      </ol>
    </div>
  );
};

/**
 * Plain-language replacements for netcheck's engineer-facing messages.
 * netcheck writes for whoever is holding a terminal. This writes for the owner.
 * An unmapped check falls through to netcheck's own wording - imperfect, but honest,
 * and better than hiding a real failure because nobody wrote a sentence for it.
 */
const PLAIN: Record<string, string> = {
  router:
    'Your router is not sending your devices to your box yet, so nothing is being filtered. This needs one setting changed on the router.',
  ipv6:
    'Your router is advertising a newer type of internet address it cannot reach. This makes phones drop off the Wi-Fi. Switch IPv6 off on your router.',
  dualhome:
    'Your box is connected two ways at once and devices get confused about which to use. Unplug either the network cable or its Wi-Fi.',
  ratelimit:
    'Your box is set to ignore devices that ask a lot of questions. On a whole household that switches everyone off for a minute at a time. We need to turn that limit off.',
  lanlistener:
    'Your box is running but is not answering the rest of the house. It should restart this by itself within two minutes.',
  filtering:
    'Your box is not blocking anything yet. Its block lists are still being built.',
  recursion:
    'Your box can block websites but cannot look up the allowed ones. Its lookup helper needs restarting.',
  bypass:
    'Your box is letting everything through on purpose because something went wrong earlier. Your internet works, but nothing is being blocked.',
  watchdog:
    'Nothing is currently keeping an eye on your box. It will not repair itself if something stops.',
};

/* -------------------------------------------------------------------------- styles */

const IonibotStyles: React.FC = () => (
  <style>{`
/* Clears the phone's floating tab bar.
 *
 * Found by screenshot on 2026-08-25: at 360dp the bubble sat exactly on top of
 * the last two destinations, so Settings and Play could not be reached at all.
 * The bar is ~64px tall and floats 12px above the safe-area inset, so the
 * bubble starts above BOTH. The --ib-fab-bottom custom property lets a host
 * with no tab bar (the pairing screen) pull it back down without forking this.
 *
 * NOTE FOR ANYONE EDITING THIS BLOCK: it lives inside a template literal, so a
 * backtick here terminates the string and the build fails with a parse error
 * fifteen lines further down. Use plain quotes in these comments.
 */
.ib-fab{position:fixed;right:16px;bottom:calc(var(--ib-fab-bottom, 92px) + env(safe-area-inset-bottom));
  display:flex;align-items:center;gap:8px;padding:12px 16px;border:0;border-radius:28px;
  background:${C.flame};color:#fff;font:600 15px/1 system-ui,-apple-system,sans-serif;
  box-shadow:0 6px 20px rgba(0,0,0,.28);z-index:9998}
.ib-fab-mark{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;
  background:rgba(255,255,255,.22);font-weight:700}
.ib-fab-text{letter-spacing:.2px}
.ib-scrim{position:fixed;inset:0;background:${C.scrim};z-index:9998}
.ib-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;flex-direction:column;
  max-height:88vh;background:${C.card};border-radius:18px 18px 0 0;
  padding-bottom:env(safe-area-inset-bottom);
  font:400 16px/1.5 system-ui,-apple-system,sans-serif;color:${C.ink};outline:none}
.ib-head{display:flex;align-items:center;justify-content:space-between;
  padding:10px 8px;border-bottom:1px solid ${C.line}}
.ib-brand{font:700 14px/1 system-ui,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:${C.sub}}
.ib-icon{width:44px;height:44px;border:0;background:none;font-size:26px;line-height:1;color:${C.sub}}
.ib-icon-blank{display:inline-block}
.ib-banner{margin:0;padding:12px 20px;background:#fdf2e6;color:${C.warn};
  font-size:14px;border-bottom:1px solid ${C.line}}
.ib-body{overflow-y:auto;padding:20px 20px 4px;-webkit-overflow-scrolling:touch}
.ib-title{margin:0 0 12px;font-size:21px;line-height:1.25;font-weight:700}
.ib-p{margin:0 0 12px}
.ib-muted{color:${C.sub};font-size:14px}
.ib-steps{margin:4px 0 16px;padding-left:24px}
.ib-steps li{margin-bottom:10px}
.ib-input{width:100%;box-sizing:border-box;padding:14px;margin:4px 0 12px;
  border:1px solid ${C.line};border-radius:10px;font-size:16px}
.ib-busy{margin:0 0 12px;color:${C.sub};font-size:14px}
.ib-problem{margin:0 0 12px;padding:12px;border-radius:10px;background:#fdecea;color:${C.bad};font-size:15px}
.ib-nc{margin:8px 0 4px;padding-top:12px;border-top:1px solid ${C.line}}
.ib-nc-list{margin:0;padding-left:0;list-style:none}
.ib-nc-row{margin:0 0 12px;font-size:15px}
.ib-ok{color:${C.good}}
.ib-fail{color:${C.ink}}
.ib-actions{display:flex;flex-direction:column;gap:10px;padding:14px 20px 20px;
  border-top:1px solid ${C.line}}
.ib-btn{min-height:50px;padding:13px 16px;border-radius:12px;font:600 16px/1.2 system-ui,sans-serif;
  border:1px solid ${C.line};background:#fff;color:${C.ink}}
.ib-btn:disabled{opacity:.5}
.ib-btn-primary{background:${C.flame};border-color:${C.flame};color:#fff}
.ib-btn-danger{background:#fff;border-color:${C.bad};color:${C.bad}}
@media (prefers-color-scheme: dark){
  .ib-sheet{background:#151a21;color:#eef2f7}
  .ib-head,.ib-actions,.ib-nc{border-color:#28303a}
  .ib-btn{background:#1d242d;border-color:#28303a;color:#eef2f7}
  .ib-input{background:#1d242d;border-color:#28303a;color:#eef2f7}
}
@media (prefers-reduced-motion: no-preference){
  .ib-sheet{animation:ib-up .22s ease-out}
  @keyframes ib-up{from{transform:translateY(14px);opacity:.6}to{transform:none;opacity:1}}
}
`}</style>
);

export default Ionibot;
