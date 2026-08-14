import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { DeviceOnboardingSimulator } from './components/DeviceOnboardingSimulator';
import { KioskPairingScreen } from './components/KioskPairingScreen';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';

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
      {showPairing ? <KioskPairingScreen /> : <DeviceOnboardingSimulator />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KioskStandalone />
  </StrictMode>
);
