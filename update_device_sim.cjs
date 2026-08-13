const fs = require('fs');
let code = fs.readFileSync('src/components/DeviceOnboardingSimulator.tsx', 'utf8');

code = code.replace(
  /export const DeviceOnboardingSimulator: React\.FC<DeviceOnboardingSimulatorProps> = \(\{[\s\S]*?\}\) => \{/,
  "import { useAppStore } from '../store/useAppStore';\nexport const DeviceOnboardingSimulator: React.FC = () => {\n  const { telemetry, userAccount, resumeProtection: onOnboardingComplete, changeFilterLevel: onChangeFilterLevel, updateUserAccount: onUpdateUserAccount } = useAppStore();"
);

fs.writeFileSync('src/components/DeviceOnboardingSimulator.tsx', code);
