# Member 2 - catalog: six hourly prompts

Send one prompt at a time. Read AGENTS.md, TEAM.md and API_CONTRACT.md first.
Own client/src/features/catalog and server/src/modules/catalog. Coordinate schema,
dependencies and global routing with the leader. Each step ends with checks and
handoff, not automatic commit/push; the human reviews and pushes personally.

## Hour 1 - products

Implement ONLY catalog step 1: database-backed product list/create/edit with name,
type, sales price, cost price and notes. Validate nonnegative integer money and
required fields, use consistent API envelopes and pagination. Provide responsive
UI with loading/error/empty states. Mutations require ADMIN; staff reads must not
become customer access. If shared auth is pending, test the router in isolation
without bypassing app gates. Do not implement variants/plans yet. Add focused
checks, run npm run check and stop for my review and push.

## Hour 2 - variants and recurring plans

Implement ONLY catalog step 2: product variants with price adjustments and plan
list/create/edit, linked to products. Support daily/weekly/monthly/yearly intervals,
price, minimum quantity and availability dates. Prevent invalid dates, quantities
and unrelated variant/product references. Follow the agreed primary-line pricing
rule so plan fees are not charged twice. Provide real selectors for Member 3.
Run checks, publish the exact response shapes and stop for my push.

## Hour 3 - plan lifecycle configuration

Implement ONLY catalog step 3: plan autoClose, allowEarlyClose, allowPause and
allowRenew controls plus active/archive behavior. Distinguish plan availability
from customer subscription expiry. Archive referenced products/plans instead of
deleting financial history. Coordinate enforcement fields with Member 3; do not
implement their subscription engine. Test admin-only writes and valid selector
filtering. Run checks and stop for my review and push.

## Hour 4 - tax rules

Implement ONLY catalog step 4: admin tax-rule list/create/edit with basis-point
rates, validation and active status. Give subscription/billing owners a reliable
API for selecting rules and snapshotting rates; do not recalculate their existing
invoices. Show percentages clearly in UI while persisting integer basis points.
Verify zero/invalid rates and permissions. Run checks and stop for my push.

## Hour 5 - discounts

Implement ONLY catalog step 5: admin-only fixed/percentage discounts, product or
whole-subscription scope, purchase/quantity thresholds, start/end dates, usage limit
and active status. Validate percentages <=100%, positive eligibility bounds, scope
and product relationship. Expose a read-only eligibility preview if useful, but
actual invoice application/redemption remains Member 4's transaction. Coordinate
the one-discount policy and units. Test boundaries, run checks and stop for my push.

## Hour 6 - catalog integration and acceptance

Implement ONLY catalog step 6: verify the catalog -> quotation -> subscription ->
invoice flow with teammates. Fix catalog defects, responsive forms, search/filtering,
pagination and permission gaps. Check plan selectors exclude unavailable/archived
options; preserve old invoice snapshots after product/tax edits. Add coordinated
demo catalog fixtures through the leader, not a separate seed system. Run checks,
report limitations and hand off for my review and push. No unrelated new features.
