import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DesktopOverlay } from './components/DesktopOverlay';
import './styles.css';

// The same page draws the desktop glow in its own window (COD-261); main opens it at #overlay.
const overlay = window.location.hash === '#overlay';
if (overlay) document.documentElement.dataset.overlay = '';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{overlay ? <DesktopOverlay /> : <App />}</React.StrictMode>);
