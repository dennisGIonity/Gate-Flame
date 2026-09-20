const fs = require('fs');
let code = fs.readFileSync('src/store/useAppStore.ts', 'utf8');

code = code.replace(
  "import { create } from 'zustand';",
  "import { create } from 'zustand';\nimport { persist, createJSONStorage } from 'zustand/middleware';"
);

code = code.replace(
  "export const useAppStore = create<AppState>((set) => ({",
  "export const useAppStore = create<AppState>()(\n  persist(\n    (set, get) => ({"
);

code = code.replace(
  "}));",
  "    }),\n    {\n      name: 'ionity-app-storage',\n      storage: createJSONStorage(() => localStorage),\n      partialize: (state) => ({ \n        telemetry: { ...state.telemetry, filterLevel: state.telemetry.filterLevel }, \n        userAccount: { ...state.userAccount, appTheme: state.userAccount.appTheme }\n      }),\n    }\n  )\n);"
);

fs.writeFileSync('src/store/useAppStore.ts', code);
