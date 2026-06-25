// Injected by vite.renderer.config.ts → define
declare const __APP_VERSION__: string;

// Ambient declarations so tsc accepts CSS / CSS-module imports that Vite handles.
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
