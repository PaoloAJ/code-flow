import { SignIn } from '@clerk/clerk-react';

/** Full-page Clerk sign-in card for the auth gate. */
export default function ClerkSignIn() {
  return <SignIn routing="hash" />;
}
