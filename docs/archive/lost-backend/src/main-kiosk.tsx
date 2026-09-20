import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { DeviceOnboardingSimulator } from './components/DeviceOnboardingSimulator';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';

function KioskStandalone() {
  useGateFlameEngine();
  const { telemetry } = useAppStore();
  
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-filter-level', telemetry.filterLevel);
    document.documentElement.classList.add('dark');
  }

  return <DeviceOnboardingSimulator />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KioskStandalone />
  </StrictMode>
);
