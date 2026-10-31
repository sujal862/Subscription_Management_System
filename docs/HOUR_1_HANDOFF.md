# Member 1 - Hour 1 handoff

Branch: foundation. Scope: backend identity and sessions only.
No database migration or new dependency is required for this step.

## Working endpoints

| Method and path | Behavior |
|---|---|
| POST /api/auth/signup | {name,email,password}; creates User + new Customer + Session atomically; 201 PublicUser |
| POST /api/auth/login | {email,password}; issues a fresh session; 200 PublicUser |
| GET /api/auth/me | 200 PublicUser for valid active session; otherwise 401 |
| POST /api/auth/logout | Revokes the presented session and clears cookie; idempotent 200 |

Response shapes remain {data: ...} and {error: {code,message,details?}}. Emails are
trimmed/lowercased; names trimmed. Signup requires name 2-100 characters, email
up to 254 and password 9-128 with uppercase/lowercase/special. Whitespace alone
does not count as a special character. Passwords are never trimmed. Extra signup
and login fields are rejected, including role and customerId.

Duplicate user OR customer email gives 409 EMAIL_IN_USE without partially creating
records. Signup never links an existing customer by email. User role is CUSTOMER.
Wrong password, missing email account and disabled account all give the same 401
INVALID_CREDENTIALS response. Signup/login each allow 30 attempts per IP per 15
minutes in the local in-memory limiter. Restart resets these limits; multi-instance
deployment would require a shared limiter store.

Passwords use salted asynchronous scrypt. Sessions use random 256-bit tokens; only
SHA-256 token hashes are stored in Session. The cookie brightloop_session lasts
seven days, is HttpOnly, SameSite=Lax, Path=/, and Secure in production. Production
deployment must use HTTPS. Do not put tokens into localStorage or API responses.
Logging out one session does not log out other devices. Expired, unknown and
disabled-user sessions cannot authenticate. User activity and role are read from
the database on every request, so role changes apply to existing sessions.

## Teammate hooks

Use requireAuth and requireRole from server/src/middleware/auth.ts. After
requireAuth, req.user is a typed PublicUser with id, name, email, role and customerId;
it contains no password or session data. requireRole without authentication returns
401, and a role mismatch returns 403.

app.ts already gates staff to ADMIN, internal modules/dashboard to ADMIN/STAFF and
portal to CUSTOMER. Module owners must still enforce their own rules: catalog
writes ADMIN only; all customer portal queries constrained by req.user.customerId.
Do not trust client-supplied ownership fields. Unfinished authorized modules remain
501; no business functionality has been implemented to bypass them.

Unsafe browser mutations from unlisted Origin or Sec-Fetch-Site: cross-site are
rejected with 403 INVALID_ORIGIN. The allowlist uses ALLOWED_ORIGINS from .env;
use the Vite /api proxy in development. Non-browser clients without Origin are
supported. Requests over 100 KB receive 413; malformed JSON receives 400.

Shared signupSchema/loginSchema/passwordSchema are available in shared/auth.ts for
the Hour 2 UI. Existing PublicUser/Role/API envelopes are unchanged. Node tests
automatically discover tests/*.test.ts; each test file uses an isolated SQLite DB
via tests/helpers/test-server.ts. Typechecking now covers test code too.

## Next steps deliberately deferred

- Hour 2: auth context, actual signup/login UI and protected navigation.
- Hour 3: staff management behavior/UI and detailed module permission integration.
- Hour 4: email/reset tokens/reset UI; reset endpoints remain 501.
- Hours 5-6: real business dashboard, filters and final integration.
- Other members continue their own catalog, subscription and billing work.

The visible overview is still the scaffold connection check, not a business report.
No admin/staff/demo account, password reset or email delivery was added in Hour 1.
For isolated module tests, create explicit role fixtures in the temporary test DB;
never bypass the real application's authentication gates.
