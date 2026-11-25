import { defineConfig } from 'vite';

// https://vitejs.dev/config
//
// __VERMILIAN_E2E_BUILD__ (VERM-106): true only when the package is built for
// the e2e suite (VERMILIAN_E2E_BUILD=1, set by test:e2e and test:e2e:fresh).
// It gates the e2e process recorder and its debug methods at build time, so a
// release package contains neither, whatever VERMILIAN_E2E says at runtime.
export default defineConfig({
  define: {
    __VERMILIAN_E2E_BUILD__: JSON.stringify(process.env.VERMILIAN_E2E_BUILD === '1'),
  },
});
