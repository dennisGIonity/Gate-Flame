import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { MobileDashboard } from './components/MobileDashboard';
import { AppPairingScreen } from './components/AppPairingScreen';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';
import { hasToken } from './services/apiClient';
import { gateflameApi } from './services/gateflameApi';

function MobileStandalone() {
  // No paired token yet: show the pairing flow instead of the dashboard.
  // Re-checked on every render via state rather than once at module load, so
  // completing pairing swaps straight to the dashboard without a reload.
  const [paired, setPaired] = useState(() => hasToken());

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
