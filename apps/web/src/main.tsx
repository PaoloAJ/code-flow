import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { api } from './api';
import { useStore } from './store';

/**
 * The auth provider is decided by the server (/api/config), so a Clerk-backed
 * deployment needs no frontend rebuild — the publishable key arrives at
 * runtime and Clerk's code is only downloaded when actually configured.
 */
async function boot() {
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  let clerkKey: string | undefined;
  try {
    const cfg = await api.config();
    useStore.getState().setAuthProvider(cfg.authProvider);
    if (cfg.authProvider === 'clerk') clerkKey = cfg.clerkPublishableKey;
  } catch {
    // server unreachable — render the app; it shows errors contextually
  }

  if (clerkKey) {
    const [{ ClerkProvider }, { ClerkBridge }] = await Promise.all([
      import('@clerk/clerk-react'),
      import('./ClerkBridge'),
    ]);
    root.render(
      <React.StrictMode>
        <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/">
          <ClerkBridge />
          <App />
        </ClerkProvider>
      </React.StrictMode>,
    );
  } else {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}

void boot();
