// Renderer entry (referenced by index.html — keep this path).
import React from 'react';
import { createRoot } from 'react-dom/client';
// eslint-disable-next-line import/no-unresolved -- exports-subpath; resolved by Vite
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
