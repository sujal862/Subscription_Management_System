# Member 1 - leader: six hourly prompts

Send ONE numbered prompt per work session, in order. Do not ask the agent to do all
six now. Read AGENTS.md and docs/TEAM.md. Each prompt includes implementation,
focused checks and a handoff. You review and push your own commits.
Do not implement Members 2-4's business modules while integrating their code.

## Hour 1 - identity and session foundation

Read the repository instructions and API contract. Implement ONLY Member 1 step 1:
backend signup/login/logout/me using the existing User, Customer and Session models.
Hash passwords and session tokens; use HttpOnly cookies, safe origin handling and
strict server validation. Enforce unique normalized emails and the exact password
rule. Signup cannot select its role or claim an existing customer by email. Replace
the fail-closed auth middleware with real requireAuth/requireRole and a typed
req.user matching PublicUser. Add focused integration tests. Do not implement reset,
staff UI or dashboard yet. Run npm run check, explain integration hooks, then stop.
Do not commit or push; I will do that.

## Hour 2 - authentication UI and protected navigation

Read current main and the prior step. Implement ONLY Member 1 step 2: login/signup
pages under /account, auth context, loading/error states, protected routes and
role-aware navigation. Admin/staff enter the workspace; customers enter their
subscription portal. Wire the real session APIs, add logout, and preserve other
members' feature routes. Verify refresh/session persistence, bad credentials and
customer access denial. Keep reset/staff/reporting for later prompts. Run checks,
report changed files, and stop for my review and push.

## Hour 3 - staff access and permission integration

Implement ONLY Member 1 step 3: admin-only GET/POST /staff and the staff management
screen. Public signup remains customer-only. Integrate role and ownership boundaries
with module owners without taking over their modules: catalog mutations admin-only,
staff allowed operational work, customers only their own portal. Add tests proving
staff cannot create staff/admin accounts and customers cannot enter staff APIs.
Handle unique conflicts without leaking stack traces. Run checks, list any contract
changes for teammates, and stop for my review and push.

## Hour 4 - password-reset email flow

Implement ONLY Member 1 step 4: forgot/reset endpoints and UI. Use expiring one-time
hashed reset tokens, generic account-existence responses, rate limits, session
invalidation after reset and safe email delivery. Support SMTP plus an explicitly
documented offline file outbox ignored by Git. Do not expose raw tokens in API
responses or logs. Test expiry, reuse, password rules and old-session rejection.
Document local and real-email configuration. Run checks and stop for my push.

## Hour 5 - business dashboard and filters

Implement ONLY Member 1 step 5: replace the starter status overview with real
database-backed DashboardSummary metrics using the agreed accounting definitions.
Add useful date/status filters and overdue summary; coordinate any extra shared
fields. Use database aggregation, indexes and pagination, not loading all invoices
into application memory. Show clear empty/loading/error states. Test totals with
partial payment, paid/draft/cancelled and overdue examples. Measure representative
queries against thousands of seeded test records. Run checks and stop for my push.

## Hour 6 - integration, verification and submission preparation

Implement ONLY Member 1 step 6: integrate current teammates' work without overwriting
their modules. Run the complete requirements/demo checklist, fix foundation or
integration defects, check responsive navigation and permissions, and verify startup
from a clean checkout. Ensure latest working code is on main through the agreed
workflow. Update README with actual setup, demo credentials/configuration and honest
limitations; never commit secrets. Report test/build results and missing requirements.
Do not invent successful checks or add major new scope. Stop for my review and push.
