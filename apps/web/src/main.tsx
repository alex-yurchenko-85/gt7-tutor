import '@fontsource/sofia-sans/400.css';
import '@fontsource/sofia-sans/500.css';
import '@fontsource/sofia-sans/600.css';
import '@fontsource/sofia-sans-condensed/600.css';
import '@fontsource/sofia-sans-condensed/700.css';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { applyTheme, storedTheme } from './app/theme.ts';

applyTheme(storedTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
