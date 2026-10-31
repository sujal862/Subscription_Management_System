# Member 1 - Hour 2 handoff

Branch: foundation. Synchronized with main at 6d8cd34 before implementation,
including Member 3's customer/subscription draft routes and screens.
Before committing, synchronized again with main at 1fd9055, including Member 4's
invoice list/detail work; the authorized billing-list assertion now expects 200.
Scope: authentication UI and protected navigation only. No backend contract,
schema, migration, demo identities, reset, staff-management or reporting feature added.

## User flow

- /account and anonymous private links lead to /account/login.
- /account/login and /account/signup call the real Hour 1 APIs. Validation reuses
  shared/auth.ts; errors stay in the form, submissions disable duplicate inputs,
  password visibility is optional and fields expose labels/error descriptions.
- Successful customer signup/login enters /portal/subscriptions. Existing ADMIN
  and STAFF accounts enter /. Allowed intended module URLs are restored after login;
  external or role-inappropriate destinations are rejected.
- AuthProvider calls /api/auth/me on application load before any private module
  renders. Session cookies remain HttpOnly; nothing is stored in localStorage.
- Backend/network failures during session checks show a retry screen rather than
  private content or a misleading anonymous login state.
- Logout calls the backend, then clears the frontend user state and returns to login.
  If logout fails, the user stays signed in and sees an error with an option to retry.
- A 401 from a protected module API clears the local session view and returns to
  login with an expiry explanation. Wrong login credentials do not trigger that event.

## Access and integration hooks

AuthProvider wraps the existing BrowserRouter application. useAuth exposes status,
user, error, notice, refreshSession, acceptUser and logout. ProtectedRoute checks
session status and an optional role list. PublicAccountRoute redirects already
signed-in users away from login/signup.

Original module mounts remain: /catalog/*, /subscriptions/*, /billing/*, /staff,
/portal/subscriptions/* and /portal/invoices/*. Members 2-4 still edit their own
feature folders. Backend middleware remains the authorization boundary; hiding a
link or redirecting on the client does not replace server ownership checks.

Navigation: ADMIN gets overview/catalog/subscriptions/billing/team; STAFF gets the
same without team administration; CUSTOMER gets own subscriptions/invoices only.
Module-specific CSS is preserved. Auth and workspace-footer styles live in their
own CSS files rather than rewriting teammates' global styles.

The API helper preserves Headers objects, reports unavailable/invalid responses
clearly and emits brightloop:session-expired only for protected API 401s.
The test runner now discovers tests/*.test.ts and tests/*.test.tsx. Four pinned
development-only dependencies support DOM tests: Testing Library React/DOM,
jsdom and its type definitions. Runtime dependencies are unchanged.

## Verification and limitations

Run npm run check for typechecks, backend tests, DOM integration tests and Vite build.
DOM tests use real session APIs and isolated SQLite: anonymous/deep-link redirects,
bad credentials, client validation, customer signup, reload/session restoration,
role-aware links, denied internal URLs, logout, offline/retry states and expired
sessions. Cookie transport is simulated in the test harness; it is not a replacement
for a real-browser visual/transport test. Browser automation was unavailable on
this machine, so no browser screenshot or mobile visual verification is claimed.

One inherited subscription test was updated from placeholder 501 to the correct
unauthenticated 401 after Hour 1 role middleware became real. Member 3 functionality
was preserved. Actual password reset remains Hour 4; no reset UI is linked yet.
The overview remains the starter connection screen until Hour 5; staff and customer
portal business functionality stays with the assigned owners/later prompts.
