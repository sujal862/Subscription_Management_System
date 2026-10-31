# Member 3: Hours 5 and 6

Scope: customer subscription portal and subscription integration/edge-case checks.
The human reviewed the local implementation and authorized committing and pushing
work/subscriptions.

## Customer portal

The existing subscriptionPortalRouter export/mount remains stable. Its implementation
is now in portal.ts; no shared app, auth, navigation or portal mount file changed.

| Method/path | Behavior |
| --- | --- |
| GET /api/portal/subscriptions | Own subscriptions, database search/status filtering and pagination |
| GET /api/portal/subscriptions/:id | Own detail with safe line amounts and totals |
| POST /api/portal/subscriptions/:id/transition | {action:"PAUSED"}, {action:"RESUME"} or {action:"CLOSED"} |
| POST /api/portal/subscriptions/:id/renew | {startDate:"YYYY-MM-DD",expiryDate:"YYYY-MM-DD"} |

customerIdFor(req) supplies scope from the real session, never from submitted input.
Unlinked users and non-customer roles are denied. List queries, counts and detail
queries filter on that identity. The reusable lifecycle service also applies the
ownership predicate inside its mutation transaction, including conditional updates
and the final read. Guessed IDs belonging to another customer return the same 404
body as absent IDs. Unknown query/body fields, including customerId, are rejected.

Responses explicitly whitelist subscription dates/status, public plan name and action
flags, snapshot descriptions, quantities, unit prices, tax rates and calculated
totals. They omit customer/user records, email, cost prices, supplier notes, catalog
relations, plan/customer IDs and internal billing anchors. Mutation responses pass
through the same whitelist rather than returning the staff service object.

The customer can never confirm quotations, activate subscriptions, alter their
commercial configuration or invoke staff lifecycle jobs. Existing plan permissions,
state guards, non-overlap checks and pending-billing guards remain authoritative.
Billing-pending responses tell customers to contact support. Customer renewal creates
an owned, linked draft for staff review; it does not bypass commercial approval.

## UI and module corrections

- Replaced the customer placeholder with responsive subscription cards, own details,
  saved line totals, status/date information and permitted actions.
- Reused lifecycle controls through a typed safe-data view and portal API prefix.
  Staff confirmation/activation, billing links and internal anchors are absent from
  customer controls. Closure requires confirmation and renewal opens its new draft.
- Added customer search/status filters, pagination, loading, empty, error, refresh and
  retry states. Abort outstanding requests on search/navigation changes to avoid
  stale responses and unmounted updates.
- Existing staff search/status/customer filters remain database-backed. Staff and
  portal lists recover from pages that become invalid after status/count changes.
  Staff actions reset the list to its first page. Search inputs match the API's
  200-character limit.
- Module CSS uses fluid card grids and wrapping line descriptions without a wide
  portal table. No global styles or shared components changed.

## Catalog/billing integration verified

The new end-to-end API test creates products, variants and plans through Member 2's
real catalog APIs, then creates a customer, template and quotation through Member 3.
It edits template quantities and catalog prices/names/variant adjustments/interval,
confirms and activates the original quotation, and runs Member 4's actual billing
API twice. The test verifies:

- Plan price appears once in the primary line; add-ons use product pricing.
- Template/catalog edits leave quotation lines, saved taxes and billingInterval intact.
- Activation supplies the initial date/anchor expected by the recurring engine.
- The first billing run creates the expected invoice; the second creates no duplicate.
- Paid historical invoice lines and payment records survive renewal and closure.
- Archived catalog products block new drafts/renewals without damaging prior records.

The initial implementation snapshot did not yet include tax configuration and
payment APIs. The disposable integration test therefore seeds a TaxRule and historical
paid/payment state explicitly. Before publication, main was fast-forwarded to
381cdf1, bringing in the owners' tax/payment work without conflicts. These fixtures
remain explicit; this integration test does not claim to exercise tax/payment writes
through those newly merged APIs. No catalog, billing, payment, email or scheduler
source outside the subscriptions module was independently edited here.

The prior handoff's overlapping-billing-worker limitation still applies: Member 4
should recheck status and the cursor inside every billing transaction. Integration
tests exercise the existing sequential billing engine and its duplicate prevention;
they do not claim to repair another owner's concurrent worker behavior. The current
schema still supplies current lifecycle milestones rather than a complete event log.

## Performance check

An isolated SQLite database is populated with 6,000 additional read-performance
fixtures split between two customers. These synthetic records exercise list/query
paths; separate integration tests use complete line-bearing subscriptions.

EXPLAIN QUERY PLAN verifies the existing indexes are used:

- Subscription_status_nextBillingDate_idx for active/due date ordering.
- Subscription_customerId_status_idx for customer/status scoping.

One full local run measured approximately 14 ms for the due query, 34 ms for a
paginated staff response and 24 ms for a paginated own-customer response. Tests enforce
the two-second target for these measured operations. This is local query/API evidence,
not a claim of universal network/browser or production performance. No indexes or
migrations were added.

## Tests and verification

```sh
npm run check
# Focused backend checks:
npx tsx --test tests/subscription-portal.test.ts tests/subscription-integration.test.ts tests/subscription-performance.test.ts
# Repository test script also includes the real-session portal DOM tests:
npm test
npm run dev
```

Final `npm run check` after syncing main passed: all 199 test results, server/frontend/test
typechecking and the production build. `git diff --check` also passed.

Tests cover two customers attempting cross-access for list/detail/pause/close/renew,
ownership tampering, unlinked sessions, role boundaries, forbidden plan actions,
customer-safe output for reads and mutations, status/search/pagination, real-session
UI actions, network-error recovery, the catalog-to-invoice acceptance flow, historical
snapshots and the indexed 6,000-record checks. UI tests use JSDOM and actual Express
and SQLite operations; no visual browser/screenshot verification was performed.

Two existing placeholder assertions were updated, as required by AGENTS.md when a
feature becomes implemented: auth.test.ts now expects an own-portal list to succeed,
and staff-permissions.test.ts expects submitted customerId to be rejected. Their
remaining role/session assertions were preserved; new behavior tests live separately.

## Files changed

- server/src/modules/subscriptions/portal.ts (new)
- server/src/modules/subscriptions/lifecycle.ts
- server/src/modules/subscriptions/router.ts
- server/src/modules/subscriptions/PART_5_6_HANDOFF.md (new)
- client/src/features/subscriptions/CustomerSubscriptionsPage.tsx
- client/src/features/subscriptions/LifecycleActions.tsx
- client/src/features/subscriptions/types.ts
- client/src/features/subscriptions/subscriptions.css
- client/src/features/subscriptions/SubscriptionsPage.tsx
- client/src/features/subscriptions/DraftForm.tsx
- client/src/features/subscriptions/QuotationsPanel.tsx
- tests/subscription-portal.test.ts (new)
- tests/subscription-portal-ui.test.tsx (new)
- tests/subscription-integration.test.ts (new)
- tests/subscription-performance.test.ts (new)
- tests/auth.test.ts (one placeholder expectation)
- tests/staff-permissions.test.ts (one placeholder expectation)

No schema/migration/dependency or shared source changes. No other member's feature
implementation was edited. This keeps integration changes narrow, although future
overlapping changes can still require conflict resolution.
