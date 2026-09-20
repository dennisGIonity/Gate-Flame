const fs = require('fs');

let code = fs.readFileSync('src/store/useAppStore.ts', 'utf8');

const safeStorageDef = `
const safeStorage = {
  getItem: (name: string) => {
    try { return localStorage.getItem(name); } catch (e) { return null; }
  },
  setItem: (name: string, value: string) => {
    try { localStorage.setItem(name, value); } catch (e) {}
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name); } catch (e) {}
  }
};
`;

code = code.replace(
  /export const useAppStore = create/,
  safeStorageDef + "\nexport const useAppStore = create"
);

code = code.replace(
  /storage: createJSONStorage\(\(\) => localStorage\),/,
  "storage: createJSONStorage(() => safeStorage),"
);

fs.writeFileSync('src/store/useAppStore.ts', code);
