import { StrictMode, Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { DeviceOnboardingSimulator } from './components/DeviceOnboardingSimulator';
import { PanelFallback } from './components/LazyFallback';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';

// DeviceOnboardingSimulator *is* the kiosk, so it stays eager. Pairing sits
// behind a button most kiosk sessions never press.
const KioskPairingScreen = lazy(() =>
  import('./components/KioskPairingScreen').then((m) => ({ default: m.KioskPairingScreen })),
);

function KioskStandalone() {
  useGateFlameEngine();
  const { telemetry } = useAppStore();
  const [showPairing, setShowPairing] = useState(false);

  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-filter-level', telemetry.filterLevel);
    document.documentElement.classList.add('dark');
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowPairing((v) => !v)}
        className="fixed right-4 top-4 z-50 rounded-lg bg-slate-800/80 px-4 py-2 text-sm font-medium text-white backdrop-blur hover:bg-slate-700"
      >
        {showPairing ? 'Back to dashboard' : 'Pair a phone'}
      </button>
      {showPairing ? (
        <Suspense fallback={<PanelFallback label="Loading pairing" className="min-h-screen" />}>
          <KioskPairingScreen />
        </Suspense>
      ) : (
        <DeviceOnboardingSimulator />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KioskStandalone />
  </StrictMode>
);
