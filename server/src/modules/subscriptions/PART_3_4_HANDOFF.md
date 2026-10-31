# Member 3: Hours 3 and 4

Scope: confirmation, activation, pause/resume, closure, expiry processing and renewal,
as explicitly requested together. Customer portal and finance work remain outside
this increment. After reviewing the local implementation, the human authorized
committing, pushing work/subscriptions and opening a pull request.

## APIs and behavior

All staff endpoints remain behind the existing real session and ADMIN/STAFF guards.

| Method/path under /api/subscriptions | Input / behavior |
| --- | --- |
| POST /:id/transition | {action:"CONFIRMED"}; QUOTATION only |
| POST /:id/transition | {action:"ACTIVE"}; CONFIRMED only, start must be due |
| POST /:id/transition | {action:"PAUSED"}; ACTIVE only, allowPause required |
| POST /:id/transition | {action:"RESUME"}; PAUSED only, allowPause required |
| POST /:id/transition | {action:"CLOSED"}; ACTIVE/PAUSED only |
| POST /:id/renew | {startDate:"YYYY-MM-DD",expiryDate:"YYYY-MM-DD"} |
| POST /process-lifecycle | {}; process due activations and eligible expiry closures |

The existing {action:"QUOTATION",validDays?} conversion is unchanged. Unknown actions,
extra status/date fields and invalid renewal dates are rejected. Invalid state edges
return 409; plan-forbidden actions 403; missing records 404. Billing backlog returns
409 BILLING_PENDING rather than dropping unprocessed periods.

Confirmation checks quotationValidUntil strictly greater than the current instant,
active plan/product, availability on the term start date, primary minimum quantity,
line values and term date ordering. Acceptance is preserved: a validly confirmed
future term can activate later even if its original quotation deadline has since
passed. Activation revalidates the term, requires startDate <= now, sets
nextBillingDate to the original startDate and billingAnchorDay to its UTC day, and
keeps the subscription's already-frozen billingInterval and price/tax snapshots.
These operations never create invoices.

If downtime spans the entire term of an already confirmed subscription, activation
is allowed for historical catch-up. Expiry closure then defers until Member 4 has
processed all eligible period starts. New confirmation of an expired term and
resumption of an expired paused term remain forbidden.

Pause keeps the billing cursor for inspection and records pausedAt. Billing already
filters status ACTIVE. Resume clears pausedAt, restores ACTIVE and sets the next
billing date to UTC midnight of the resume date, retaining the original anchor.
Paused days are not caught up. Existing invoiced periods are not refunded or
prorated; financial adjustments remain Member 4's responsibility.

Manual closure honors allowEarlyClose before expiry (including open-ended terms).
At or after expiry it permits closure regardless of that early-close flag. Closed
subscriptions retain their original term/cursor and closedAt, but are excluded by
the existing billing status filter. Existing invoices and payments remain untouched.

Renewal creates a distinct DRAFT with a new unique number, copied snapshot lines
and payment terms, current plan interval, and a `[Renewal of SUB-...]` description
link. The new draft must complete its own quotation/confirmation flow. It cannot
overlap the old term or start in the past. An early-closed term uses closedAt as its
boundary; an open-ended term must first close. The same source/start/expiry retry
returns the existing renewal; a conflicting expiry for that source/start returns
409. The source subscription, paid invoices and payments are never rewritten.

## Automatic processing and Member 4 integration contract

`processSubscriptionLifecycle({now?,limit?})` is exported from lifecycle.ts. It uses
bounded queries (100 per stage by default; maximum 1000), reports activated/closed
IDs and per-subscription deferrals, and makes no invoices. A module-owned timer
runs every minute outside NODE_ENV=test; it is unref'd and overlapping local ticks
are suppressed. Staff may also run the same processing through the API/UI. Exported
start/stop functions in scheduler.ts allow a future shared scheduler to own it.

The inspected Member 4 engine uses an **exclusive expiry boundary**: only period
starts strictly before expiryDate are eligible. This module follows that rule:

1. Process lifecycle to activate due confirmed terms.
2. Member 4 runs `runBillingCycle` (with bounded catch-up as usual).
3. Process lifecycle again, or let the next minute tick close expired terms.

Automatic closure requires autoClose and either a paused term with its prior
billing already settled, or an ACTIVE term whose nextBillingDate has reached or
passed expiry. A missing active cursor or earlier cursor defers closure. A capped
or failed billing run therefore cannot silently skip the remaining eligible starts.
Pause/early close similarly require the billing cursor to be beyond the current
instant, or at the exclusive expiry boundary when already expired.

This is the proposed callable scheduler contract for Member 4; no external teammate
message was sent and no claim of teammate approval is made. Billing source and shared
startup files were deliberately left untouched. The existing billing engine caches
candidate subscriptions: its owner should recheck ACTIVE status and the current
cursor inside each billing transaction before supporting overlapping billing workers
and concurrent lifecycle actions. The tests here cover sequential catch-up/expiry
coordination and concurrent lifecycle state changes, not that cross-worker race.

## UI

Subscription details now show the lifecycle path, current status, next billing
date, anchor, pause/closure timestamps, quotation deadline and renewal source link
inside copied descriptions. Buttons honor plan flags and require explicit closure
confirmation. Future activations are explained, billing backlog errors link to the
existing billing screen, and renewal opens its own draft. The process-due button
reports completions and readable per-subscription deferrals.

The existing schema has no lifecycle event table: these are available milestones
and current-state timestamps, not a fabricated complete audit trail. No shared
schema, migration, package, global style, auth or billing implementation was changed.

## Validation and fixtures

`tests/fixtures/subscriptions.ts` exports `createLifecycleFixture(db, options)` for
Member 4's isolated billing tests, defaulting to a valid ACTIVE monthly subscription
with snapshot lines, initial cursor and anchor. It never runs automatically or
seeds a development database.

Tests cover valid/forbidden transitions, expired quotations (including exact
deadline), minimum quantity, availability, future starts, scheduler activation,
month-end billing, plan permissions, paused-time exclusion, pending-billing guards,
capped expiry catch-up, manual/automatic closure, renewal idempotency, preservation
of paid invoice lines/payments, real database rollback, concurrent confirmation,
real session/role denial and UI actions against the actual Express/SQLite APIs.

```sh
npm run check
npx tsx --test tests/subscription-lifecycle.test.ts
# UI tests use the repository test script's JSX configuration:
npm test
npm run dev
```

Final verification: `npm run check` passed, including server/frontend/test
typechecking, all 131 test results and the production build. `git diff --check`
passed. Lifecycle UI tests use JSDOM against the real authenticated Express API and
an isolated SQLite database; no visual browser automation was performed.

## Changed files

- server/src/modules/subscriptions/lifecycle.ts (new)
- server/src/modules/subscriptions/scheduler.ts (new)
- server/src/modules/subscriptions/router.ts
- server/src/modules/subscriptions/quotations.ts
- server/src/modules/subscriptions/PART_3_4_HANDOFF.md (new)
- client/src/features/subscriptions/LifecycleActions.tsx (new)
- client/src/features/subscriptions/SubscriptionsPage.tsx
- client/src/features/subscriptions/types.ts
- client/src/features/subscriptions/subscriptions.css
- tests/fixtures/subscriptions.ts (new)
- tests/subscription-lifecycle.test.ts (new)
- tests/subscription-lifecycle-ui.test.tsx (new)
- tests/quotations.test.ts (updated earlier-stage expectations for new actions)

At the start of this increment, origin/main and this branch had identical file
contents, despite different merge history. No merge commit was created. Keeping
edits in Member 3's ownership reduces conflicts; later overlapping edits can still
require resolution.
