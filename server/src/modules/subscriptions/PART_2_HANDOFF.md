# Member 3, Hour 2: quotation templates and quotations

Source: [MEMBER_3.md, Hour 2](../../../../docs/prompts/MEMBER_3.md#hour-2---quotation-templates-and-quotations).
Implemented only template management, template-based quotations and DRAFT to
QUOTATION. Confirmation, activation, billing, renewal and portal work remain outside
this increment. The human authorized committing and pushing this increment after
reviewing the local handoff.

## Implemented behavior

- Template list with database search and pagination; create, detail, partial edit,
  line replacement and delete. Includes plan, product/variant lines, payment terms
  and validity days. Missing records return 404 and invalid input returns 400.
- Template lines use the plan price once for the primary product and product prices
  for add-ons, including variant adjustments. New/replaced lines follow the existing
  no-price-override policy. Stored template prices are copied to quotations even if
  the catalog prices subsequently change.
- Template-based creation copies lines into independent SubscriptionLine records,
  copies payment terms, freezes the billing interval and sets QUOTATION with a
  server-generated number. Product descriptions and current applicable tax rates
  are captured at quotation creation. Template edits or deletion never update those
  saved quotation records.
- DRAFT to QUOTATION uses a guarded status update, preserves draft price/tax/line
  snapshots and sets quotationValidUntil. Repeated conversion returns 409. All later
  lifecycle actions are rejected by this increment's strict transition schema.
- Quotation validity is an exact UTC instant: creation/conversion time plus validDays
  elapsed days. Template validity defaults to 14 days; allowed range 1–365. Draft
  conversion also defaults to 14, with an explicit validity input in the UI.
- Creation and template line replacement are transactional. Tests inject actual
  SQLite write failures to verify no partial parents, lost old lines or partial
  quotations remain.
- UI: template list/search/pagination, reusable catalog-backed template editor,
  details and totals, inline delete confirmation, template-to-quotation form with
  paginated customer search, draft conversion action and quotation validity display.
  Existing subscription search/status filters also list quotations.

## API

All routes below live under `/api/subscriptions`, with real session and ADMIN/STAFF
checks inherited from the application and subscriptions router.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /templates | Page of templates; page, pageSize, search |
| POST | /templates | Create {name, planId, validDays?, paymentTermDays?, lines} |
| GET | /templates/:id | Details with line amounts, tax and totals |
| PATCH | /templates/:id | Partial metadata edit or atomic line replacement |
| DELETE | /templates/:id | Delete template and its lines; retain quotations |
| POST | / | With templateId, create a QUOTATION from that template |
| POST | /:id/transition | {action: "QUOTATION", validDays?}; DRAFT only |

Template-based POST example:

```json
{
  "templateId": "template_id",
  "customerId": "customer_id",
  "startDate": "2026-11-01",
  "expiryDate": "2027-11-01"
}
```

expiryDate is optional. An optional planId must match the template. Template-based
requests reject submitted lines, payment terms, status and quotation deadlines:
the saved template supplies its commercial configuration. The existing non-template
draft POST format is unchanged. Partial template PATCH preserves omitted defaults;
changing the plan requires explicitly supplying replacement lines.

No schema/migration changes: existing QuotationTemplate, QuotationTemplateLine,
Subscription and SubscriptionLine are sufficient. Template lines have no ordering
column; reads consistently order their IDs and place the plan product first. The
copied unit price is already final, so variant adjustments are never added again.

## Integration and merge scope

Fast-forwarded work/subscriptions to origin/main at `1fd9055`, including the team's
auth and billing work, without conflicts or a merge commit. Feature edits are only
in Member 3's folders and Member 3 tests. Shared schema, dependencies, application
mounts, auth, global styles and other feature modules were not edited. This reduces
conflict risk; future overlapping edits can still require conflict resolution.

Catalog APIs remain pending on this main snapshot. The editor shows the existing
catalog unavailable state and uses no fake records. Product variants appear when
the catalog product response includes them. Real authorization is now integrated
and tested through production routes with actual login sessions.

## Verification

```sh
npm run typecheck
npx tsx --test tests/quotations.test.ts tests/quotations-access.test.ts tests/subscriptions.test.ts
npm run build
npm run check
```

- Typechecking of server, frontend and tests passed.
- Module suites passed in the full test run: quotation business behavior, real-session
  authorization and existing customer/draft regression tests.
- Production build passed; no browser automation was performed.
- Full `npm run check` currently fails on an unrelated stale expectation in
  `tests/auth.test.ts:166`: the merged billing list now returns 200 for staff, but
  the auth test still expects its old placeholder status 501. This assertion concerns
  the already-merged billing module and was left untouched to avoid editing another
  member's test. All other test cases passed. Build was also run separately because
  `check` stops before build when that test fails.

## Files in this increment

- client/src/features/subscriptions/DraftForm.tsx
- client/src/features/subscriptions/SubscriptionsPage.tsx
- client/src/features/subscriptions/QuotationsPanel.tsx
- client/src/features/subscriptions/subscriptions.css
- client/src/features/subscriptions/types.ts
- server/src/modules/subscriptions/router.ts
- server/src/modules/subscriptions/quotations.ts
- server/src/modules/subscriptions/PART_2_HANDOFF.md
- tests/subscriptions.test.ts (real auth now returns 401, replacing the old 501 gate)
- tests/quotations.test.ts
- tests/quotations-access.test.ts

Next increment: Hour 3, confirmed and active lifecycle, only when requested.
