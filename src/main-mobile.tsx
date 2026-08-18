import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { MobileDashboard } from './components/MobileDashboard';
import { AppPairingScreen } from './components/AppPairingScreen';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';
import { hasToken, onTokenRejected } from './services/apiClient';
import { gateflameApi } from './services/gateflameApi';

function MobileStandalone() {
  // No paired token yet: show the pairing flow instead of the dashboard.
  // Re-checked on every render via state rather than once at module load, so
  // completing pairing swaps straight to the dashboard without a reload.
  const [paired, setPaired] = useState(() => hasToken());

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

  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-filter-level', telemetry.filterLevel);
    document.documentElement.classList.add('dark');
  }

  if (!paired) {
    return (
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
    );
  }

  return <MobileDashboard />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileStandalone />
  </StrictMode>
);
