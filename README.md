# Brightloop - Subscription Management System

One repository for a four-person hackathon team. **Member 1 Hours 1-2 provide backend
session authentication, login/signup UI, protected routes and role-aware navigation.**
Member 3's customer/subscription drafts and Member 4's initial invoice work are
integrated from main. Password reset,
staff management and business reporting remain future work. Unfinished APIs return HTTP 501
after authentication/authorization (401/403 if access is denied).

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

`setup` copies .env.example only if .env is missing, generates Prisma Client,
applies committed migrations and runs the empty seed hook. It does not reset data.
SQLite is local at prisma/dev.db and is ignored by Git.
No Docker, cloud database, email credentials or paid services are needed for setup.

## Team start

Read [team workflow](docs/TEAM.md), [API contract](docs/API_CONTRACT.md),
[requirements](docs/REQUIREMENTS.md), and your six hourly prompts:

| Member | Module | Prompt file | Working branch |
|---|---|---|---|
| 1 - leader | Auth, permissions, staff, dashboard | [Member 1](docs/prompts/MEMBER_1.md) | foundation |
| 2 | Products, plans, taxes, discounts | [Member 2](docs/prompts/MEMBER_2.md) | work/catalog |
| 3 | Customers, quotations, subscriptions | [Member 3](docs/prompts/MEMBER_3.md) | work/subscriptions |
| 4 | Recurring invoices, payments | [Member 4](docs/prompts/MEMBER_4.md) | work/billing |

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
| npm run check | Typecheck, scaffold smoke tests, production build |
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
docs/prompts/          one prompt per member per hour
tests/                 backend and DOM integration tests with isolated databases
```

Included libraries for later steps: Zod, cookie-parser, express-rate-limit and
Nodemailer. Zod, cookie-parser and rate limits are used by the Hour 1 backend;
email integration remains for Hour 4.
The product must eventually persist business data, authorize every request, support
the customer portal and pass the final acceptance checklist. This starter alone
does not satisfy the hackathon problem statement.

## Member 1 Hour 1 handoff

See [identity and session integration notes](docs/HOUR_1_HANDOFF.md) for working
API routes, cookie behavior, teammate middleware hooks and remaining scope.
No demo users are seeded yet. Public signup only creates CUSTOMER accounts.

## Member 1 Hour 2 handoff

See [UI and navigation integration notes](docs/HOUR_2_HANDOFF.md). Sessions restore
from the HttpOnly cookie after refresh; customers see only their portal links.
Run npm ci after pulling to install the pinned DOM-testing development dependencies.
