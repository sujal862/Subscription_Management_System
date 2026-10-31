# Member 4 - billing: six hourly prompts

Send one prompt at a time. Read AGENTS.md, TEAM.md and API_CONTRACT.md first.
Own client/src/features/billing and server/src/modules/billing, including
billingPortalRouter. Coordinate shared changes and scheduler registration with
the leader. No payment gateway is required. End each step with focused checks
and handoff; the human reviews, commits and pushes personally.

## Hour 1 - invoice model behavior and calculation service

Implement ONLY billing step 1: invoice calculation service and invoice list/detail
API/UI using the existing schema. Read actual subscription lines; calculate
subtotal, eligible discount structure, tax and total in integer paise on the server.
Snapshot customer/description/price/rates into invoice records. Start with zero
discount until eligibility is added; do not fake success. Use isolated DB fixtures
if Member 3's UI is pending. Validate ownership/roles and add calculation tests.
Run checks and stop for my review and push.

## Hour 2 - recurring billing engine

Implement ONLY billing step 2: POST /billing/run and shared recurring engine using
nextBillingDate. Prevent duplicates with the existing unique billing-period key
and transactions; advance nextBillingDate only with successful invoice creation.
Support daily/weekly/monthly/yearly calendar intervals and anchor-day clamping.
Handle repeat runs and bounded catch-up without skipped periods. Coordinate
subscription activation/expiry boundaries with Member 3. Test repeated/concurrent
runs, month ends and rollback behavior. Run checks and stop for my push.

## Hour 3 - invoice actions and discount application

Implement ONLY billing step 3: Draft -> Confirmed invoice action and cancellation
rules; automatic eligible discount selection, date/threshold/scope/usage checks and
atomic redemption in invoice creation. Apply the agreed one-discount policy and
tax-after-discount rounding. Prevent double usage on repeated billing and preserve
invoice snapshots. Cancellation must not orphan payments or silently rebill a
cancelled period. Test expired/exhausted discounts and totals. Run checks and stop.

## Hour 4 - payment records and balances

Implement ONLY billing step 4: payment entry/list with method, amount, date, note
and optional unique reference. Support partial payments, remaining balances and
Paid transition only when fully paid. Reject overpayment, duplicate references,
and payment against draft/cancelled invoices, including concurrent attempts. Add
overdue/status filters and pagination; coordinate dashboard accounting definitions
with Member 1. No fake gateway. Test balances and authorization; run checks and stop.

## Hour 5 - customer invoices, print and email

Implement ONLY billing step 5: customer invoice list/detail/print through
billingPortalRouter, scoped to authenticated customerId. Add a clean printable
invoice and staff send action using Member 1's shared mail helper. Do not create
a second email/configuration system. Keep SMTP and explicit offline mode usable.
Ensure email content/print totals match stored snapshots and customer cannot view
another invoice. Test ownership and delivery behavior. Run checks and stop for my push.

## Hour 6 - scheduler, recovery and integration verification

Implement ONLY billing step 6: register the same billing engine on backend startup
and a small scheduler through leader-coordinated integration. Process missed due
periods safely, avoid overlapping runs, skip paused/closed/noneligible periods and
preserve eligible final periods at expiry. Integrate catalog discounts, lifecycle,
payments and dashboard. Measure indexed queries with thousands of subscriptions.
Test restart, duplicate prevention and full demo flow. Report honest limitations,
run all checks and stop for my review and push. No unrelated new features.
