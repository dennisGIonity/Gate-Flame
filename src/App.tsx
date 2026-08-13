import React, { useState, useEffect } from 'react';
import { AppViewMode } from './types';
import { AppLayout } from './components/layout/AppLayout';
import { MobileDashboard } from './components/MobileDashboard';
import { DeviceOnboardingSimulator } from './components/DeviceOnboardingSimulator';
import { ServerSyncArchitecture } from './components/ServerSyncArchitecture';
import { DeploymentScriptViewer } from './components/DeploymentScriptViewer';
import { ContainerArchitectureView } from './components/ContainerArchitectureView';
import { FutureFeatureRoadmap } from './components/FutureFeatureRoadmap';
import { ExportPackagingCenter } from './components/ExportPackagingCenter';
import { useGateFlameEngine } from './hooks/useGateFlameEngine';
import { useAppStore } from './store/useAppStore';

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
      {currentView === 'mobile_apk' && (
        <MobileDashboard />
      )}
      {currentView === 'device_kiosk' && (
        <DeviceOnboardingSimulator />
      )}
      {currentView === 'server_sync' && (
        <ServerSyncArchitecture />
      )}
      {currentView === 'scripts_bom' && (
        <DeploymentScriptViewer />
      )}
      {currentView === 'container_architecture' && (
        <ContainerArchitectureView />
      )}
      {currentView === 'future_roadmap' && (
        <FutureFeatureRoadmap />
      )}
      {currentView === 'package_export' && (
        <ExportPackagingCenter />
      )}
    </AppLayout>
  );
}
