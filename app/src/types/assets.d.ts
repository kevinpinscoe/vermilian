// Injected by vite.renderer.config.ts → define
declare const __APP_VERSION__: string;
// Injected by vite.main.config.ts and vite.preload.config.ts → define (VERM-106): true only in an e2e build.
declare const __VERMILIAN_E2E_BUILD__: boolean;

// Ambient declarations so tsc accepts CSS / CSS-module imports that Vite handles.
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
