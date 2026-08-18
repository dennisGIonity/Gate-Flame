import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { MobileDashboard } from './components/MobileDashboard';
import { AppPairingScreen } from './components/AppPairingScreen';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';
import { getToken, hasToken, onTokenRejected } from './services/apiClient';
import { gateflameApi } from './services/gateflameApi';
import { forgetNode } from './services/nodeDiscovery';
import Ionibot, { defaultDeps } from './ionibot';
import { buildIonibotContext, learnGateway } from './services/ionibotContext';

function MobileStandalone() {
  // No paired token yet: show the pairing flow instead of the dashboard.
  // Re-checked on every render via state rather than once at module load, so
  // completing pairing swaps straight to the dashboard without a reload.
  const [paired, setPaired] = useState(() => hasToken());

  // The gateway comes from the box (netcheck reports it) and is then cached, so
  // every router-instruction screen renders with the handset offline. Learned
  // opportunistically and silently — see services/ionibotContext.ts.
  const [gateway, setGateway] = useState<string | null>(null);

  // The owner can revoke this handset from the kiosk. When that happens the
  // node starts answering 401, apiClient drops the dead token, and this puts
  // the user back on the pairing screen.
  //
  // Without it, revocation was invisible on the device: `paired` was read once
  // at mount, so the dashboard stayed up showing whatever it last had and
  // retried a dead credential every 4 seconds forever. A revoke that the
  // handset ignores is not a revoke.
  useEffect(() => onTokenRejected(() => setPaired(false)), []);

  useGateFlameEngine();
  const { telemetry } = useAppStore();

  useEffect(() => {
    if (!paired) return;
    let live = true;
    void learnGateway().then((g) => {
      if (live && g) setGateway(g);
    });
    return () => {
      live = false;
    };
  }, [paired]);

  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-filter-level', telemetry.filterLevel);
    document.documentElement.classList.add('dark');
  }

  /**
   * IONIBOT IS MOUNTED AT THE ROOT, ON PURPOSE, AND ON BOTH BRANCHES.
   *
   * It renders a floating button over whatever the customer is doing and is
   * never a destination. Mounting it inside the dashboard would make the help
   * unavailable during pairing — which is the single moment a customer is most
   * likely to be stuck, and the whole reason the IB-1xx setup screens exist.
   *
   * MOBILE ONLY. The kiosk is deliberately not touched: it is served from the
   * box over loopback and has its own console.
   */
  const ionibot = (
    <Ionibot
      ctx={buildIonibotContext(gateway)}
      contactUrl="mailto:info@ionity.today"
      probeDeps={{
        ...defaultDeps,
        // The netcheck route is read-scoped. Injected here rather than read
        // inside src/ionibot/, which imports nothing but its own types so the
        // folder stays droppable into another app.
        authToken: getToken,
      }}
      startPairing={async () => {
        // Ionibot's "find my box again" hands control back to the app rather
        // than trying to drive pairing itself.
        //
        // Drops the remembered address so discovery races the candidates again
        // instead of retrying a box that has moved — which is the actual
        // complaint behind IB-209. The TOKEN IS LEFT ALONE: this is "I cannot
        // see it", not "unpair me", and wiping a good token here would make a
        // customer on the wrong Wi-Fi re-pair for no reason.
        forgetNode();
        setPaired(false);
      }}
    />
  );

  if (!paired) {
    return (
      <>
        <AppPairingScreen
          onPaired={() => {
            // Re-run discovery/connect now that a token exists, then flip to
            // the dashboard — useGateFlameEngine's own connect() call will
            // pick up the live state on its next poll regardless, this just
            // avoids the ~4s wait for the first tick.
            void gateflameApi.connect();
            setPaired(true);
          }}
        />
        {ionibot}
      </>
    );
  }

  return (
    <>
      <MobileDashboard />
      {ionibot}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileStandalone />
  </StrictMode>
);
