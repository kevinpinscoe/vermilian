// Renderer entry (referenced by index.html — keep this path).
import React from 'react';
import { createRoot } from 'react-dom/client';
// An "exports" subpath, resolved by Vite at build time and by tsc under
// moduleResolution: bundler. It previously needed an eslint-disable for
// import/no-unresolved, whose legacy resolver could not read exports maps;
// that plugin is gone and the compiler resolves this correctly.
import '@vibe/core/tokens';
import './index.css';
import { Providers } from './renderer/providers';
import { App } from './renderer/App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');
createRoot(container).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
