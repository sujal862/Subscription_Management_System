# Final four-member integration review

Started on main c32411e after pulling origin/main and fast-forwarding/pushing
foundation to the same commit. The user's final-review instruction authorizes
cross-module fixes beyond the earlier hourly ownership restrictions. No teammate
work was discarded and no force push was used. The previous hourly handoffs are
historical; their pending-feature lists no longer describe this final integration.

## Corrected defects

- Confirm/cancel responses omitted balance fields. The real browser found that
  confirming an invoice hid Record Payment until the user reopened it. Mutation
  responses now include the same balance/overdue fields as detail reads.
- Billing read a cursor outside its transaction and could move it backwards during
  overlapping runs. Each period now reads and conditionally advances the saved
  cursor inside one transaction. Counters update only after a successful commit.
  Selection is bounded to 100 subscriptions per run (internal max 1000), with a
  12-period default catch-up limit per subscription and hasMore for remaining work.
  Expired terms whose cursor has already reached expiry cannot fill the queue.
- Discount allocation could over-allocate one-paise shares. Largest remainder
  allocation now conserves the exact saving. Product discounts evaluate and allocate
  across all matching product lines/variants, rather than only the first line.
- Invoice, lines, discount reservation and redemption always share a transaction,
  including direct service calls. A conditional reservation protects use limits.
  BigInt tax rounding and monetary bounds prevent overflow/fractional paise writes.
- Confirmation/cancellation now share transactions with their status/payment checks.
  Cancellation/payment races cannot leave payments on a cancelled invoice.
- Customer invoice list/detail/print responses use explicit public fields. Staff
  payment notes/references, full customer relations and internal discount thresholds
  are omitted. Ownership is part of the detail query; cross-customer requests get 404.
- Invoice email HTML escapes user-controlled names/addresses/descriptions. File
  delivery is clearly reported as a private offline outbox, rather than an inbox.
- Overdue listing filters positive balances inside SQLite before counting/paging.
  Invalid filters, dates and oversized monetary inputs are rejected safely.
- One scheduler owns activation -> bounded billing -> expiry closure. It starts
  after database connection and drains before shutdown. Routers have no timer side
  effects merely from being imported. Known database conflicts return safe messages.
- Staff catalog pages hide mutation controls, retaining previews/reads. The server
  continues to enforce admin-only writes. Mobile subscription grid width and
  billing-table overflow/print layout were corrected after browser checks.
- Staff print output lacked its invoice identity because the title was inside a
  non-print header. A print-only business/invoice/status heading is now included;
  internal payment notes and bank references stay off customer-facing printouts.
- On this Windows/Node 20.11 machine, the tsx watch wrapper started a child that
  never listened. Direct execution and Node's built-in watcher both started the
  API correctly; dev:server now uses node --watch --import tsx. Node 20.11 prints
  its experimental-watch notice; no dependency/version upgrade is required.

## Verification

The normal npm run check covers TypeScript, backend/DOM integration and production
build. New final-review regressions exercise one-paise allocation, multiple variant
lines, forced rollback, concurrent cursor/use-limit/payment/cancellation scenarios,
customer DTOs, escaped file email, overdue filtering and ordered scheduler catch-up.
The normal demo test now includes a real configured discount, tax, partial/final
payments, file-email send, both own portals and cross-customer denial.

Final results: npm run check passed all **238 tests**, TypeScript checks and
production build. After the final print-only change, typecheck/build and the real
browser journey passed again. The browser journey adds one separate test, with
10 route/viewport checks against 3,001 subscriptions: slowest readiness **929ms**,
zero JavaScript page errors. The dashboard benchmark used 3,002 subscriptions,
6,011 invoices and 6,006 payments; its slowest summary+page pair was **316.3ms**.
The subscription benchmark used 6,000 records (staff page 67.7ms, own-customer
page 43.8ms). These are representative local measurements, not remote latency.

Native browser-control tools failed because the native pipe/browser host was absent.
An isolated Playwright 1.56.1 install under ignored .local/browser-tools uses the
machine's installed Microsoft Edge in headless mode. See README for the command;
[Playwright's browser documentation](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
describes the installed Edge channel. No user profile, saved credentials or external
services are used by the browser test.

scripts/browser-smoke.mjs tests actual cookie login/refresh, a discounted/taxed
quotation-to-invoice flow, real UI invoice confirmation, partial/final payments,
dashboard and overdue accounting, email into the file outbox, printable PDF, both
customer portals, customer ownership and staff denial. It checks five internal
routes at 1440px and 390px against 3001 database subscriptions, measures readiness
(including a 500ms network-idle wait), and checks document overflow. Screenshots,
print PDF and timing JSON stay in .local/final-verification and are not committed.
This is representative local Chromium/Edge coverage, not every device or browser.

Fresh-start verification clones the local main checkout into a new temporary
directory, overlays the proposed changes, installs pinned dependencies with npm ci,
and runs setup/build. No .env, DB, node_modules or dist is copied. Startup/health,
SPA deep links/assets and identity/session persistence across restart are checked
against that isolated DB. The final fixes remain local until the user publishes them.
The running development app also returns HTTP 200 at /, /api/health through Vite,
and the direct API health endpoint. The Windows startup watcher fix was verified
with npm run dev. The configured administrator's real login, /auth/me and dashboard
access were checked, then that test session was logged out.

## Demo configuration and remaining limits

Public signup creates a CUSTOMER. Create an admin explicitly with private .env
ADMIN_EMAIL/ADMIN_PASSWORD and npm run admin:create, then create staff through Team
access. Setup creates no identities. Never commit passwords or the local outbox.
On the leader's machine, the user authorized private .env configuration; a valid
ADMIN_PASSWORD was saved there and the configured administrator was created.
Credentials are not stored in this report, logs or a committed demo fixture.

Default MAIL_MODE=file is an honest offline email demonstration. Real SMTP provider
credentials/inbox delivery have not been verified. For actual email use the private
settings in EMAIL_SETUP.md; APP_URL must match the real application origin and use
HTTPS for production password resets. Payment recording is manual, not a gateway.

Local SQLite and in-process scheduling/outbox delivery are intended for this
hackathon demo. A restart retries billing from its saved cursor; permanently invalid
subscriptions require staff correction, and a large backlog continues in bounded
minute-by-minute batches. Email is best effort, with no durable mail retry queue.
There is no claim of hosted deployment, actual printer output or real-inbox delivery.
Git contribution frequency is a human process; automated tests cannot prove every
member pushed in every one-hour window.

## Follow-up: subscription View buttons

Reproduced against the populated local demo: the admin View button loaded details
above the visible table (section top -1443px); the customer View subscription button
loaded details below the cards without moving focus. Both pages now bring loading,
error and selected details into view and move keyboard focus to the displayed
section. Admin requests also cancel superseded loads and requests on unmount.
Customer details and authorization still use the existing real APIs; no API or
schema contract changes were needed.

Live Edge checks verified both buttons at 1440px and 390px, including closing the
details. The customer UI test now asserts focus and scrolling, and the separate
browser journey covers both buttons, reopening, plus admin failure visibility and
recovery. No user demo records were changed by these read-only button checks.

After this correction, npm run check passed all 238 tests, TypeScript and the
production build. The updated isolated Edge browser journey also passed, including
both View buttons at desktop/mobile widths, close/reopen and network-error recovery.

## Local Gmail SMTP configuration

The user-provided Gmail app credentials were configured only in the ignored .env,
using MAIL_MODE=smtp, SMTP_PASS, MAIL_FROM and required STARTTLS on port 587.
The sender uses the authenticated Gmail address. Gmail SMTP authentication and
TLS verification succeeded, and the development API was restarted. This check did
not send an email; real inbox receipt remains unverified. APP_URL still points to
http://localhost:5173, so reset links target this machine's local application.
