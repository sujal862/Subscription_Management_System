# Member 1 - Hours 3 and 4

Branch foundation, synchronized with main c675c2d before implementation.
The user's combined-hour request overrides the original one-hour-per-turn plan.
No database migration, dependency upgrade or other members' business implementation
is included. Dashboard/reporting remains Hour 5.

## Staff access

- GET /api/staff is ADMIN-only and returns Page<PublicUser>. Query: page (default 1),
  pageSize (default 20, max 100), search (name/email). It lists only STAFF accounts.
- POST /api/staff is ADMIN-only; input {name,email,password}. Server fixes role to
  STAFF and customerId remains null. Extra role/customerId fields are rejected.
  The new account does not replace the creating admin's session.
- Duplicate emails return 409 EMAIL_IN_USE with a safe message, no database details.
  Password policy and normalization are shared with signup; hashes never appear in responses.
- /staff has create, search, pagination, loading/empty/error/success states and clears
  the initial password after creation. Navigation/route checks remain role-aware.
- Public signup remains CUSTOMER-only. Staff can operate existing sales/billing
  APIs but cannot create identities or mutate catalog; customers cannot access those APIs.
- requireCustomerAccount rejects unlinked customer identities. customerIdFor(req)
  returns the authenticated customer's ID independently of submitted ownership fields.
  Members 3/4 must apply it in every future portal resource query. Their portal
  resource endpoints are still pending and were not implemented by this change.

No default admin account/password is created. Configure ADMIN_NAME, ADMIN_EMAIL
and ADMIN_PASSWORD privately and run npm run admin:create for a new administrator.
This explicit bootstrap refuses existing user/customer emails instead of promoting
or changing them. Existing users remain unchanged. Automated tests bootstrap only
an isolated temporary database; your actual development identities are untouched.

## Recovery

- /account/forgot-password sends POST /api/auth/forgot-password {email}; valid input
  always gets the same generic response for known, unknown, disabled or failed-delivery cases.
- /account/reset-password reads a #token= fragment into memory and removes it from
  the URL. It is intentionally accessible even with an existing signed-in session.
  It validates password/confirmation and sends only {token,password} to the reset API.
- Token: 256 random bits, only SHA-256 hash in DB, 30-minute expiry. Resend invalidates
  older links after a 60-second email cooldown. IP limits: forgot 20/reset 30 per 15 min.
- Reset consumption, password replacement and deletion of every target session/token
  are atomic. Concurrent attempts can succeed only once. Disabled/expired/used tokens fail.
- Reset success clears the browser cookie/local auth state, does not auto-login and
  leaves other users' sessions intact. Invalid links offer a request-new-link action.
- sendMail({to,subject,text,html?}) is the shared narrow mail helper for Member 4.
  It supports SMTP and private MIME-file delivery; it excludes raw/path/URL attachment
  options and rejects newline header injection. SMTP errors are sanitized.
- No raw reset token/password/email content in API responses or application logs.
  Raw links are delivered only through email (including the explicit local email outbox).

See EMAIL_SETUP.md for configuration, delivery limits and the in-process queue limitation.
Real SMTP account credentials and real external inbox delivery are not configured or claimed.

## Changed areas and checks

Staff backend/UI and CSS; auth reset service/router/shared schemas/recovery UI;
auth context and route registration; customer-scope middleware; shared mail helper;
graceful shutdown; explicit administrator CLI/package script; env example/docs;
isolated backend/SMTP/DOM tests and obsolete placeholder assertions.

No dependency install is required if Hour 2's packages are already installed.
Validation completed: npm run check passed TypeScript checks, all 110 tests and
the production build. Tests cover privilege escalation and unique errors, operational
staff access, portal identity checks, explicit bootstrap refusal, generic recovery,
expiry, reuse, concurrent consumption, invalid passwords, all-session revocation,
delivery failure without leaked content, local SMTP transport and staff/recovery UI.
Browser automation is unavailable here; DOM tests exercise real APIs but do not
substitute for final manual visual and actual-provider inbox checks.
