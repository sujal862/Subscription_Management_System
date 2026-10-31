# Part 1: customers and subscription drafts

Scope source: [docs/prompts/MEMBER_3.md — Hour 1](../../../../docs/prompts/MEMBER_3.md#hour-1---customers-and-subscription-drafts),
with the shared API contract and ownership rules. Hours 2–6 remain out of scope.

## Prompt 1 acceptance checklist

- [x] Customer list/create/edit using real database records.
- [x] Subscription draft list/create/details using the existing schema.
- [x] Select existing catalog plans/products; no duplicate catalog.
- [x] Persist unique numbers, customer, plan, dates, payment terms and lines.
- [x] Validate quantities, money and relationships on the server.
- [x] Register fixed customer routes before the subscription /:id route.
- [x] Test handlers in isolation while production authentication is pending.
- [x] Run checks and document teammate dependencies for human review.
- [x] Keep changes uncommitted and unpushed until explicitly authorized by the human.

Implemented customer list, search, pagination, details, create and edit; subscription
list, search, status/customer filters, details and atomic DRAFT creation. All data
uses the existing Customer, Subscription and SubscriptionLine models. No schema,
migrations, shared contracts, dependencies or shared application files changed.

## Endpoints

All paths below are under `/api/subscriptions`, behind the shared authentication
gate and the ADMIN/STAFF role gate.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /customers | Paginated search across name, email, company and phone |
| POST | /customers | Create a customer with normalized unique email |
| GET | /customers/:id | Customer details and subscription count |
| PATCH | /customers/:id | Edit supplied contact fields; preserve linked user |
| GET | / | Paginated subscriptions; search, status and customerId filters |
| POST | / | Create subscription and snapshot lines in one transaction |
| GET | /:id | Details with line amounts, subtotal, tax and total |

List inputs: `page` (default 1), `pageSize` (default 20, maximum 100), `search`.
Success/error envelopes follow the shared contract. Draft prices default to plan
price on the first (primary) line, product price on add-ons, plus variant adjustment.
The primary line must match the plan product and satisfy its minimum quantity.
Tax rounds half-up per line using integer arithmetic. All totals are integer paise;
the maximum total is 2,147,483,647 paise, matching the database's Int monetary fields.
Dates must be real YYYY-MM-DD dates, saved at UTC midnight and displayed in
Asia/Kolkata. Start date must fall within the plan's availability window.

Numbers use `SUB-<UTC year>-<16 random hex characters>` with the existing unique
index and bounded collision retries. Status is always DRAFT; billing anchor and
next billing date remain null. Client status and calculated-total fields are rejected.

## Frontend

Customer search/table/pagination and create/edit panel; customer details;
subscription search/table/pagination/status filter and customer filter via each
customer row; subscription details; draft form with paginated customer selection,
catalog plan/product/variant/tax selection, dates, payment terms, add-on lines and
price preview. Includes loading, error, empty, retry and save notifications. Styles
are scoped to this feature folder.

## Verification and running

From the repository root:

```sh
npm ci
npm run setup
npm run check
npx tsx --test tests/subscriptions.test.ts
npm run dev
```

The module test runs migrations against a disposable SQLite database, mounts only
the route handlers in an isolated Express application, and separately verifies the
production role router fails closed. It covers customer validation, mixed-case
duplicates, update conflicts, linked-user preservation, paging, draft persistence,
unique numbers, default prices, line/tax totals, invalid references/dates/quantities,
archived catalog records, failure without partial records and historical snapshots.
The existing `npm run check` command runs the foundation tests only; run the module
test explicitly as above. No shared test or package script was altered.

Verified locally: `npm run check` passed (typechecking, five foundation test results,
production build); the separate module test passed all nine test results. Development
API health and Vite returned HTTP 200; the production customer route returned the
expected fail-closed 501. The temporary development servers were stopped afterward.
No browser automation or completed-authentication end-to-end test was performed.

## Integration dependencies and remaining work

- Member 1: requireAuth/requireRole still intentionally return 501. Browser CRUD
  remains inaccessible until real sessions and authorization are integrated. Do not
  bypass either production gate. Real role/ownership integration testing follows
  that implementation; isolated tests are not proof of finished authentication.
- Member 2: catalog endpoints currently return 501. Draft creation shows an
  unavailable state. Selectors consume GET /catalog/plans, /products and /taxes
  using the shared Page response, including pagination. Variants appear when the
  product response includes them; no undocumented variants endpoint is called.
  Tax API failure is explicitly shown; users may still create a draft without tax.
  Browser catalog integration must be verified once those APIs are implemented.
- The contract says overrides must be validated by role but defines no specific
  role policy. Until agreed, all supplied prices must equal their catalog defaults;
  omitted unit prices are derived by the server. No arbitrary overrides are enabled.
- No quotations, lifecycle actions, portal behavior, billing or discounts were
  added. Part 2 is quotation templates and quotations.

## Changed files

- server/src/modules/subscriptions/router.ts
- server/src/modules/subscriptions/validation.ts
- server/src/modules/subscriptions/PART_1_HANDOFF.md
- client/src/features/subscriptions/SubscriptionsPage.tsx
- client/src/features/subscriptions/DraftForm.tsx
- client/src/features/subscriptions/types.ts
- client/src/features/subscriptions/subscriptions.css
- tests/subscriptions.test.ts
- .gitignore (local databases, secrets, generated files, caches and reports)

Implementation branch: work/subscriptions. Commit and push only with explicit human
authorization; the human requested publication after the initial local handoff.
