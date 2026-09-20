const fs = require('fs');
let code = fs.readFileSync('src/components/ServerSyncArchitecture.tsx', 'utf8');

code = code.replace(
  /export const ServerSyncArchitecture: React\.FC<ServerSyncArchitectureProps> = \(\{[\s\S]*?\}\) => \{/,
  "export const ServerSyncArchitecture: React.FC = () => {\n  const { userAccount, updateUserAccount: onUpdateUserAccount } = useAppStore();"
);

fs.writeFileSync('src/components/ServerSyncArchitecture.tsx', code);
