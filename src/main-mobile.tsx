import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { MobileDashboard } from './components/MobileDashboard';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';

function MobileStandalone() {
  useGateFlameEngine();
  const { telemetry } = useAppStore();
  
  // Quick hack to force filterLevel on body for themes
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-filter-level', telemetry.filterLevel);
    document.documentElement.classList.add('dark');
  }

  return <MobileDashboard />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileStandalone />
  </StrictMode>
);
