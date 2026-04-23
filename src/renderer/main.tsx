import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';
import { applyTheme } from './lib/theme';

applyTheme('system');
createRoot(document.getElementById('root')!).render(<App />);
