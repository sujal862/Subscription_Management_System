# Brightloop - Subscription Management System

Built by a four-person hackathon team, Brightloop provides session authentication,
protected navigation, staff management, password recovery and a database-backed
business dashboard. The application includes products/variants/plans,
customers, templates, subscription lifecycle, taxes, recurring invoices and payments.
All four modules are integrated, including discount management, invoice send/print,
both customer portals and scheduled billing. Final review fixes cover billing
concurrency, exact discount allocation, portal response privacy and mobile layout.
See [final verification](docs/FINAL_REVIEW.md) for results, configuration and limits.

## Start locally

Prerequisite: Node.js 20.11+ (22 LTS recommended), npm and Git.
The dependencies are pinned for compatibility with the existing Node 20.11 machine.

```sh
git clone https://github.com/sujal862/Subscription_Management_System.git
cd Subscription_Management_System
npm ci
npm run setup
npm run dev
```

Open http://localhost:5173; anonymous visitors are sent to /account/login.
Use /account/signup to create a customer account and enter the customer portal.
Existing ADMIN/STAFF accounts enter the internal workspace. There is no public
role selector or seeded admin account. API health: http://localhost:4000/api/health.

To create your first administrator, set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD
in your private .env, then run `npm run admin:create`. This explicit command creates
a new admin only; it never promotes or overwrites an existing account. Do not commit
credentials. Once signed in, use Team access to create staff accounts.

Password recovery is at /account/forgot-password. By default, emails are delivered
to private .local/outbox/*.eml files for the offline demo. Open the latest email
file and copy its complete reset link into the browser. This does not deliver to a
real inbox. For real SMTP configuration, see [email setup](docs/EMAIL_SETUP.md).

`setup` copies .env.example only if .env is missing, generates Prisma Client,
applies committed migrations and runs the empty seed hook. It does not reset data.
SQLite is local at prisma/dev.db and is ignored by Git.
No Docker, cloud database, email credentials or paid services are needed for setup.

## Team start

Read [team workflow](docs/TEAM.md), [API contract](docs/API_CONTRACT.md),
and [requirements](docs/REQUIREMENTS.md).

| Member | Module | Working branch |
|---|---|---|
| 1 - leader | Auth, permissions, staff, dashboard | foundation |
| 2 | Products, plans, taxes, discounts | work/catalog |
| 3 | Customers, quotations, subscriptions | work/subscriptions |
| 4 | Recurring invoices, payments | work/billing |

Create YOUR branch after cloning (example for Member 2):

```sh
git switch -c work/catalog
git push -u origin work/catalog
```

Do not create four repositories or an organization. Each member makes their own
branch from main; the leader does not submit everyone's commits under one identity.
Temporary branches do not replace the organizer's requirement to keep main current:
integrate working increments every 40-45 minutes. If organizers prohibit temporary
branches entirely, use the serialized main workflow in TEAM.md instead.

## Commands

| Command | Purpose |
|---|---|
| npm run setup | Prepare local environment/database without destructive resets |
| npm run dev | Start React and API together; Ctrl+C stops both |
| npm run check | Typecheck, backend/DOM integration tests and production build |
| npm run db:studio | Inspect your local database |
| npm run db:migrate -- --name descriptive_change | Leader creates a coordinated schema migration |
| npm run db:deploy | Apply teammates' committed migrations after pulling |
| npm run db:seed | Empty hook until team agrees on fixtures |
| npm run build | Build frontend and backend |
| npm start | Serve built app/API at http://localhost:4000 |

Run from the repository root. Keep API port 4000 and Vite port 5173 during
development; change the Vite proxy too if coordinating a different API port.
After a pull with dependency/schema changes: npm ci, then npm run setup.
The tests use a temporary SQLite database, not your local development data.

## Layout

```text
client/src/features/    independent member UI folders
client/src/components/ shared scaffold layout
server/src/modules/    independent member API routers
server/src/middleware/ session, role and request-origin checks
server/src/lib/        DB, HTTP and configuration helpers
shared/                response shapes, statuses and money formatting
prisma/                agreed starting schema and migration history
docs/                  setup, API contracts, requirements and verification
tests/                 backend and DOM integration tests with isolated databases
```

Zod, cookie-parser, rate limits and Nodemailer support validation, real cookie
sessions and email delivery. Local application data persists in SQLite. After npm
ci has completed, normal offline use needs no cloud APIs; dependency installation
and GitHub synchronization require network access. External SMTP delivery and a
hosted production deployment require separate configuration and verification.

## Member 1 Hour 1 handoff

See [identity and session integration notes](docs/HOUR_1_HANDOFF.md) for working
API routes, cookie behavior, teammate middleware hooks and remaining scope.
No demo users are seeded yet. Public signup only creates CUSTOMER accounts.

## Member 1 Hour 2 handoff

See [UI and navigation integration notes](docs/HOUR_2_HANDOFF.md). Sessions restore
from the HttpOnly cookie after refresh; customers see only their portal links.
Run npm ci after pulling to install the pinned DOM-testing development dependencies.

## Member 1 Hours 3-4 handoff

See [staff and password recovery notes](docs/HOUR_3_4_HANDOFF.md). No schema migration
or new package is needed for these steps. New configuration keys are optional
administrator bootstrap fields, MAIL_OUTBOX_DIR and SMTP_REQUIRE_TLS.

## Dashboard and submission

After pulling these changes run `npm run setup` to apply the dashboard index
migration. `/` shows active subscriptions, pre-tax invoiced revenue, collected,
outstanding and overdue balances. Date filters select invoice issue days in
Asia/Kolkata. Payments/balances are current for those invoices; active subscriptions
always counts all current ACTIVE records. Draft/cancelled invoices never contribute.
The overdue list is paginated on the server. Definitions are in the API contract.

There are **no shipped demo credentials**. Configure your own private ADMIN_EMAIL
and ADMIN_PASSWORD, run `npm run admin:create`, sign in, and create staff via Team
access. Use public signup for a new customer identity; matching an existing customer
email does not claim that record. This intentionally avoids a shared known password.

For a current demo: admin creates product/variant/plan in Catalog; create a customer,
quotation template and quotation in Subscriptions; add a configured tax rule to a line;
confirm then activate with a start date on/before today; run Billing for today and
repeat to demonstrate no duplicate. Confirm the generated draft invoice, record a
partial payment, check the Dashboard and then record the remaining balance. The
invoice becomes PAID and the Dashboard reflects the collection. The real HTTP
integration test covers this flow. Account creation, persistence, permissions,
staff management and recovery can also be demonstrated. Never directly edit the
demo DB to bypass workflow steps. Discounts can be configured in Catalog and are
applied before tax on billing. The invoice can be emailed through SMTP or the
private file outbox, printed from its detail view, and read from its customer's
portal. The scheduler activates due terms, bills due periods and closes expired
terms after catch-up; it runs at startup and every minute.

Optional browser verification (requires an installed Microsoft Edge):

```sh
npm install --prefix .local/browser-tools --no-save --package-lock=false playwright@1.56.1
npm run build
node --import tsx scripts/browser-smoke.mjs
```

This keeps browser tooling outside the pinned application dependencies. The check
uses an isolated temporary database and random in-memory credentials. Screenshots,
print PDF and timing results are ignored under .local/final-verification. It does
not use your development data or send messages to a real email provider.

Production-style local serving: `npm run build`, then set APP_URL to
`http://localhost:4000` in private .env and run `npm start`; use localhost consistently.
For internet deployment use HTTPS, the matching APP_URL/ALLOWED_ORIGINS and SMTP.
Reset URLs require HTTPS in production; the default HTTP offline reset demo runs
using `npm run dev`. Production Secure cookies require a suitable browser/HTTPS
environment; no hosted deployment is included or verified.
