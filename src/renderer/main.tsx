import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';
import './i18n/config';
import { applyTheme } from './lib/theme';

applyTheme('system');
createRoot(document.getElementById('root')!).render(<App />);
