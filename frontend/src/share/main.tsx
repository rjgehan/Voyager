// The guest page of shares (ROADMAP item 42, DESIGN §6.45): its own entry (share.html), so none of
// the owner's app runs here: no service worker, manifest, settings, tree, workspace or extensions.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installViewportVars } from '../editor/mobileViewport';
import { installInputModality } from '../features/focus';
import { applyTheme, installThemeListener } from '../state/prefs';
import { GuestApp } from './GuestApp';
import '../styles/tokens.css';
import '../styles/app.css';
import '../styles/editor.css';
import '../styles/reading.css';
import '../styles/features.css';
import '../styles/mobile.css';
import './share.css';

applyTheme();
installThemeListener();
installViewportVars();
installInputModality();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuestApp />
  </StrictMode>,
);
