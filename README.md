# Brightloop - Subscription Management System

One repository for a four-person hackathon team. **This commit is only the shared
starter: no authentication, billing, catalog CRUD or business dashboard is complete.**
All feature screens are labeled placeholders and business APIs return HTTP 501.

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

Open http://localhost:5173. API: http://localhost:4000/api/health.
The overview checks the actual API/database connection. No account is required
because no private data or functional business screens exist yet.

`setup` copies .env.example only if .env is missing, generates Prisma Client,
applies committed migrations and runs the empty seed hook. It does not reset data.
SQLite is local at prisma/dev.db and is ignored by Git.
No Docker, cloud database, email credentials or paid services are needed for setup.

## Team start

Read [team workflow](docs/TEAM.md), [API contract](docs/API_CONTRACT.md),
[requirements](docs/REQUIREMENTS.md), and your six hourly prompts:

| Member | Module | Prompt file | Working branch |
|---|---|---|---|
| 1 - leader | Auth, permissions, staff, dashboard | [Member 1](docs/prompts/MEMBER_1.md) | work/foundation |
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
server/src/middleware/ future auth gates (currently fail closed)
server/src/lib/        DB, HTTP and configuration helpers
shared/                response shapes, statuses and money formatting
prisma/                agreed starting schema and migration history
docs/prompts/          one prompt per member per hour
tests/                 scaffold integration smoke tests
```

Included libraries for later steps: Zod, cookie-parser, express-rate-limit and
Nodemailer. They are available but their feature integrations are not implemented.
The product must eventually persist business data, authorize every request, support
the customer portal and pass the final acceptance checklist. This starter alone
does not satisfy the hackathon problem statement.
