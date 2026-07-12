import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export function AuthModal({
  onClose,
  inline,
}: {
  onClose?: () => void;
  /** Render as a bare card (auth gate) instead of a modal overlay. */
  inline?: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const authRequired = useStore((s) => s.authRequired);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user } =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.signup({ email, password, name });
      useStore.getState().setAuth(user, authRequired);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const card = (
    <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
      <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Sign up
          </button>
        </div>
        {mode === 'signup' && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={mode === 'login'}
        />
        <input
          type="password"
          placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
        />
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" onClick={submit} disabled={busy || !email || !password}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
    </div>
  );

  if (inline) return card;
  return (
    <div className="modal-backdrop" onClick={authRequired ? undefined : onClose}>
      {card}
    </div>
  );
}
