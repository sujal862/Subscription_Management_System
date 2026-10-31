# Brightloop

### Subscription Management System

Brightloop brings customer subscriptions, recurring billing and payment tracking into one workspace. Businesses can manage their catalog, prepare quotations, follow subscription lifecycles and track outstanding balances. Customers have a separate portal for their subscriptions and invoices.

Built for the Odoo hackathon by **Sujal Raj, Anuj Pal, Prince Seth and Vansh Tyagi**.

## Features

- **Catalog:** Products, variants, recurring plans, tax rules and discounts.
- **Customers and quotations:** Customer records, reusable quotation templates and subscription drafts.
- **Subscription lifecycle:** Quotation, confirmation, activation, pause, renewal and closure, subject to plan permissions.
- **Billing:** Scheduled recurring invoices, discounts before tax, partial payments and payment history.
- **Dashboard:** Active subscriptions, invoiced revenue, collections, outstanding balances and overdue invoices, with date filters.
- **Customer portal:** Access to a customer's own subscriptions, invoices and permitted subscription actions.
- **Account management:** Cookie-based sessions, admin/staff/customer permissions, staff creation and password recovery.
- **Invoice delivery:** SMTP email or a local file outbox, plus a printable invoice view.

## Technology

| Layer | Stack |
|---|---|
| Frontend | React, TypeScript, Vite, React Router |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite with Prisma |
| Validation | Zod |
| Email | Nodemailer |
| Testing | Node.js test runner, Testing Library, jsdom; optional Playwright browser checks |

Business data is stored in the database and served through the API. Core workflows run locally after dependencies are installed; SMTP email requires an internet connection.

## Getting started

Install **Node.js 20.11 or later**, npm and Git, then run:

```sh
git clone https://github.com/sujal862/Subscription_Management_System.git
cd Subscription_Management_System
npm ci
npm run setup
npm run dev
```

Open **http://localhost:5173**. The API runs at `http://localhost:4000`, with a health endpoint at `/api/health`.

Setup creates `.env` from `.env.example` if needed, generates Prisma Client and applies database migrations. It preserves existing data. The local database, environment file and email outbox are excluded from Git.

### Create an administrator

Set these values in your private `.env`:

```dotenv
ADMIN_NAME=Your name
ADMIN_EMAIL=your-email@example.com
ADMIN_PASSWORD=your-private-password
```

Use a password longer than eight characters with uppercase, lowercase and a special character. Then run:

```sh
npm run admin:create
```

Sign in and open **Team access** to create staff accounts. Public signup creates customer accounts only. No accounts or shared passwords are included in the repository.

### Email configuration

The default `MAIL_MODE=file` saves emails under `.local/outbox` for an offline demonstration. For real email delivery, configure `MAIL_MODE=smtp` and your provider's SMTP settings in `.env`. Restart the API after changing environment settings.

Password reset links expire after 30 minutes, work once and invalidate existing sessions after a successful reset. Set `APP_URL` to the address where users open the application.

See [email setup](docs/EMAIL_SETUP.md) for SMTP, TLS and outbox instructions.

## Demo walkthrough

1. Sign in as an administrator and create a product, variant, recurring plan and tax rule in **Catalog & plans**. Add a discount if required.
2. In **Subscriptions**, create a customer and a quotation template with product lines, quantities and taxes.
3. Create a quotation for that customer, confirm it and activate the subscription. Use a start date on or before today to demonstrate billing immediately.
4. Open **Invoices & payments** and run billing. Running it again for the same period does not create a duplicate invoice.
5. Confirm the draft invoice and record a partial payment. Check the outstanding and overdue balances on **Overview**.
6. Record the remaining payment. The invoice becomes paid and the dashboard reflects the collection.
7. View or print the invoice, send it through the configured email channel and check the linked customer's portal.

The scheduler runs at startup and every minute to process due activations, billing periods and eligible closures. Customer portal access requires a linked customer account; the API enforces record ownership.

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the frontend and API |
| `npm run setup` | Prepare the environment and apply migrations |
| `npm run check` | Run type checks, tests and the production build |
| `npm test` | Run backend and UI integration tests |
| `npm run build` | Build the application |
| `npm start` | Serve the built application on port 4000 |
| `npm run db:studio` | Browse the local database |
| `npm run db:deploy` | Apply committed database migrations |

Run commands from the repository root. After pulling dependency or schema changes, run `npm ci` and `npm run setup`.

## Verification

The latest local verification passed **238 tests**, TypeScript checks and the production build. Tests use isolated temporary databases. A separate Edge browser check covers the billing journey, permissions, subscription detail buttons and desktop/mobile layouts.

To run the optional browser check with Microsoft Edge installed:

```sh
npm install --prefix .local/browser-tools --no-save --package-lock=false playwright@1.56.1
npm run build
node --import tsx scripts/browser-smoke.mjs
```

See [verification notes](docs/FINAL_REVIEW.md) for coverage and local measurements.

## Project structure

```text
client/src/features/    Catalog, subscriptions, billing, auth and dashboard UI
client/src/components/  Shared layout and navigation
server/src/modules/     Business APIs
server/src/middleware/  Authentication, permissions and request checks
server/src/lib/         Database, email and configuration helpers
shared/                API contracts, validation and money utilities
prisma/                Database schema and migrations
tests/                 API and UI integration tests
docs/                  Setup, contracts, requirements and verification
```

## Team

| Team member | Responsibility |
|---|---|
| **Sujal Raj** - Team Lead | Authentication, access control, staff management, dashboard and integration |
| **Anuj Pal** | Products, variants, recurring plans, taxes and discounts |
| **Prince Seth** | Customers, quotations and subscription lifecycle |
| **Vansh Tyagi** | Recurring billing, invoices, payments and customer invoice portal |

Development uses one shared repository with module branches and integration into `main`. See the [team workflow](docs/TEAM.md) and [API contract](docs/API_CONTRACT.md).

## Current scope

Brightloop is a local hackathon application backed by SQLite. Payments are recorded manually; no payment gateway is connected. Email uses the configured SMTP service or file outbox, with no durable retry queue. Hosted deployment and real inbox receipt have not been verified.

For deployment, configure HTTPS, `APP_URL`, `ALLOWED_ORIGINS` and SMTP for the target environment. Keep credentials and local data outside version control.
