import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api, setAuthTokenGetter } from './api';
import { useStore } from './store';

/**
 * Connects Clerk's session to the rest of the app: registers the token
 * getter used by every API/WS call and mirrors the signed-in user into the
 * store (which drives presence names and the ?d= join gate).
 */
export function ClerkBridge() {
  const { getToken, isSignedIn, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      setAuthTokenGetter(() => getToken());
      api
        .me()
        .then((me) => useStore.getState().setAuth(me.user, me.authRequired))
        .catch(() => {});
    } else {
      setAuthTokenGetter(null);
      useStore.getState().setAuth(null, useStore.getState().authRequired);
    }
  }, [isLoaded, isSignedIn, getToken]);

  return null;
}
