import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import './style.css';
import './foundation.css';

const root = document.getElementById('root');
if (!root) throw new Error('UNLOSS root element is missing.');
createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter><App /></BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
);
