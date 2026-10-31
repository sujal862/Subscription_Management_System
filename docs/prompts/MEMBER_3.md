# Member 3 - subscriptions: six hourly prompts

Send one prompt at a time. Read AGENTS.md, TEAM.md and API_CONTRACT.md first.
Own client/src/features/subscriptions and server/src/modules/subscriptions,
including subscriptionPortalRouter. Coordinate shared changes with the leader.
Do not bypass pending authentication. End each step with checks and handoff;
the human reviews, commits and pushes personally.

## Hour 1 - customers and subscription drafts

Implement ONLY subscription step 1: customer list/create/edit and subscription
draft list/create/details from real DB records and the existing schema. Follow
the catalog contract for plan/product selectors; do not create a second catalog.
Persist unique numbers, customer, plan, dates, payment terms and product lines.
Validate quantities, money and relationships server-side. Register fixed router
paths before /:id. Test in an isolated router if auth is pending. Run checks,
explain dependencies to teammates and stop for my review and push.

## Hour 2 - quotation templates and quotations

Implement ONLY subscription step 2: quotation template CRUD with plan, product
lines, payment terms and validDays. Create a subscription quotation from a template
with copied lines and quotationValidUntil. Support DRAFT -> QUOTATION and show
the correct calculated line totals without double-counting plan prices. Validate
template/product/variant references and preserve independent subscription lines
after template edits. Run focused checks and stop for my push.

## Hour 3 - confirmed and active lifecycle

Implement ONLY subscription step 3: controlled QUOTATION -> CONFIRMED -> ACTIVE
transitions. Enforce quotation validity, plan availability, minimum quantities and
date ordering. Confirmed future-start subscriptions activate only when due; agree
the scheduler hook with billing owner. Set nextBillingDate and original anchor day
on activation; preserve billingInterval. Do not generate invoices yourself. Test
forbidden transitions and provide Member 4 valid active fixtures. Run checks and stop.

## Hour 4 - pause, closure and renewal

Implement ONLY subscription step 4: per-plan pause/resume, early close, expiry
auto-close and renew controls. Coordinate date boundaries/scheduler processing with
Member 4 so expiry handling cannot skip an eligible billing period. Paused time
is not billed; resume schedules from resume date. Renewal creates a new term
without rewriting historical invoices. Test denied actions, closure and renewal
dates. Keep status history understandable in UI. Run checks and stop for my push.

## Hour 5 - customer subscription portal

Implement ONLY subscription step 5: own-customer subscription list/detail and
plan-permitted pause/close/renew actions using subscriptionPortalRouter. Derive
customerId from the authenticated user, never trust a submitted customer ID.
Prevent ID guessing and disclose only customer-safe fields. Add search/status
filters for staff and responsive portal states. Test two customers attempting
cross-access and forbidden plan actions. Run checks and stop for my review and push.

## Hour 6 - subscription integration and edge cases

Implement ONLY subscription step 6: verify templates -> active subscriptions ->
recurring invoices with Member 4 and catalog edits with Member 2. Fix this module's
date, validation, paging, permissions and responsive issues. Check the due-date
query against thousands of records, using agreed indexes. Preserve paid historical
invoices on renewal/closure. Run end-to-end acceptance and focused checks; report
remaining limitations and stop for my review and push. Do not take over billing.
