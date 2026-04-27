import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from './lib/query-client';
import { App } from './App';
import './styles/globals.css';
import './i18n/config';
import { applyTheme } from './lib/theme';

applyTheme('system');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={getQueryClient()}>
    <App />
  </QueryClientProvider>,
);
