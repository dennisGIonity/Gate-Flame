import React, { Suspense, lazy, useState, useEffect } from 'react';
import { AppViewMode } from './types';
import { AppLayout } from './components/layout/AppLayout';
// The web preview renders the REAL phone app, not a copy of it. MobileDashboard
// (deleted 2026-08-24) was a separate implementation that drifted from both the
// phone and the console; a preview that shows something the customer will never
// see is worse than no preview.
import MobileApp from './mobile/MobileApp';
import { PanelFallback } from './components/LazyFallback';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';

/*
 * `mobile_apk` is the landing view, so MobileDashboard stays statically
 * imported — deferring the one thing the user is guaranteed to see first only
 * buys a round trip. Every other view sits behind a nav click and is fetched
 * when that click happens.
 */
const DeviceOnboardingSimulator = lazy(() =>
  import('./components/DeviceOnboardingSimulator').then((m) => ({
    default: m.DeviceOnboardingSimulator,
  })),
);
const ServerSyncArchitecture = lazy(() =>
  import('./components/ServerSyncArchitecture').then((m) => ({
    default: m.ServerSyncArchitecture,
  })),
);
const DeploymentScriptViewer = lazy(() =>
  import('./components/DeploymentScriptViewer').then((m) => ({
    default: m.DeploymentScriptViewer,
  })),
);
const ContainerArchitectureView = lazy(() =>
  import('./components/ContainerArchitectureView').then((m) => ({
    default: m.ContainerArchitectureView,
  })),
);
const FutureFeatureRoadmap = lazy(() =>
  import('./components/FutureFeatureRoadmap').then((m) => ({
    default: m.FutureFeatureRoadmap,
  })),
);
const ExportPackagingCenter = lazy(() =>
  import('./components/ExportPackagingCenter').then((m) => ({
    default: m.ExportPackagingCenter,
  })),
);

/** Fallback caption per view, so the spinner names the panel that is arriving. */
const VIEW_LOADING_LABEL: Record<string, string> = {
  device_kiosk: 'Loading node kiosk',
  server_sync: 'Loading server sync',
  scripts_bom: 'Loading scripts & BOM',
  container_architecture: 'Loading containers',
  future_roadmap: 'Loading roadmap',
  package_export: 'Loading export centre',
};

export default function App() {
  const [currentView, setCurrentView] = useState<AppViewMode>('mobile_apk');
  const { telemetry, userAccount } = useAppStore();

  useGateFlameEngine();

  // Theme management effect
  useEffect(() => {
    const applyTheme = () => {
      const isDark = 
        userAccount.appTheme === 'dark' || 
        (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

      if (isDark) {
        document.documentElement.classList.add('dark');
        document.body.setAttribute('data-filter-level', telemetry.filterLevel);
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.body.setAttribute('data-filter-level', telemetry.filterLevel);
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();

    if (userAccount.appTheme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }
  }, [userAccount.appTheme, telemetry.filterLevel]);

  useEffect(() => {
    document.body.setAttribute('data-filter-level', telemetry.filterLevel);
  }, [telemetry.filterLevel]);

  return (
    <AppLayout
      currentView={currentView}
      onSelectView={setCurrentView}
      protectionActive={telemetry.protectionStatus === 'active'}
      totalBlocked={telemetry.queriesBlockedToday}
      filterLevel={telemetry.filterLevel}
      appTheme={userAccount.appTheme}
    >
      {currentView === 'mobile_apk' ? (
        <MobileApp />
      ) : (
        /* One boundary, keyed on the view: switching views re-suspends rather
           than holding the previous panel on screen while the next downloads. */
        <Suspense
          key={currentView}
          fallback={<PanelFallback label={VIEW_LOADING_LABEL[currentView] ?? 'Loading view'} />}
        >
          {currentView === 'device_kiosk' && <DeviceOnboardingSimulator />}
          {currentView === 'server_sync' && <ServerSyncArchitecture />}
          {currentView === 'scripts_bom' && <DeploymentScriptViewer />}
          {currentView === 'container_architecture' && <ContainerArchitectureView />}
          {currentView === 'future_roadmap' && <FutureFeatureRoadmap />}
          {currentView === 'package_export' && <ExportPackagingCenter />}
        </Suspense>
      )}
    </AppLayout>
  );
}
