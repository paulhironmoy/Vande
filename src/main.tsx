import '@fontsource-variable/manrope';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/utilities.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerPwa } from '@/pwa/register';

document.documentElement.lang = 'en';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

registerPwa();
