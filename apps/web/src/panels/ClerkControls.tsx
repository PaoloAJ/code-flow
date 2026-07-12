import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';

/** TopBar auth controls when the server runs in Clerk mode. */
export default function ClerkControls() {
  return (
    <>
      <SignedIn>
        <UserButton />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="primary">Sign in</button>
        </SignInButton>
      </SignedOut>
    </>
  );
}
