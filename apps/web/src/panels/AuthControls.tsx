import { Suspense, lazy, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { AuthModal } from './AuthModal';

// Clerk UI is only downloaded when the server actually runs in Clerk mode.
const ClerkControls = lazy(() => import('./ClerkControls'));

/** Sign-in button / signed-in chip, provider-aware. Used by TopBar + Dashboard. */
export function AuthControls() {
  const user = useStore((s) => s.user);
  const authRequired = useStore((s) => s.authRequired);
  const authProvider = useStore((s) => s.authProvider);
  const [showAuth, setShowAuth] = useState(false);

  if (authProvider === 'clerk') {
    return (
      <Suspense fallback={null}>
        <ClerkControls />
      </Suspense>
    );
  }
  if (user) {
    return (
      <button
        className="ghost user-chip"
        title={`${user.email} — click to sign out`}
        onClick={async () => {
          await api.logout().catch(() => {});
          useStore.getState().setAuth(null, authRequired);
        }}
      >
        <span className="peer-avatar self">{user.name.slice(0, 1).toUpperCase()}</span>
        {user.name}
      </button>
    );
  }
  return (
    <>
      <button className="ghost" onClick={() => setShowAuth(true)}>
        Sign in
      </button>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
