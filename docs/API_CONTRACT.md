# Shared interface, version 1

Implemented after Member 1 Hour 1: GET /api/health, POST /api/auth/signup,
POST /api/auth/login, POST /api/auth/logout and GET /api/auth/me, plus session and
role middleware. Member 1 Hours 3-4 also implement admin GET/POST /api/staff and
POST /api/auth/forgot-password and /api/auth/reset-password. Other module routes
follow their owners' progress; route listings alone do not indicate completion.

## Conventions

- Base /api. Success { data: T }. Failure { error: { code, message, details? } }.
- List result { data: { items, page, pageSize, total } }. Default pageSize 20, max 100.
- IDs are Prisma cuid strings. UTC ISO-8601 instants; date-only billing inputs use
  YYYY-MM-DD normalized to UTC midnight. Display business dates consistently in
  Asia/Kolkata. Never silently use a developer machine's timezone.
- Currency INR. All *Minor values are integer paise. Quantities positive integers.
- Tax rateBps: 1800 = 18%. PERCENTAGE discount value uses basis points too (1000 = 10%).
  FIXED discount value is paise. Validate percentage <=10000 and amounts >=0.
- Subscription line unitPriceMinor is the final per-seat price including variant
  adjustment. Primary line defaults to Plan.priceMinor + variant adjustment;
  add-on lines default to Product.salesPriceMinor + variant adjustment. Never add
  the plan fee a second time. Validate submitted overrides according to role.
- Server calculates line subtotal, eligible discount, then tax on discounted base.
  Round monetary calculations to paise; cap discounts at eligible subtotal.
- Do not stack discounts initially: choose the largest eligible savings deterministically.
  Product-scope discount requires productId; whole-subscription scope does not.
- Snapshot descriptions/prices/customer details/rates on invoices. Future catalog
  edits must not rewrite issued invoices. Freeze subscription interval at creation.
- Real sessions in HttpOnly cookies; requireAuth attaches PublicUser to req.user.
  ADMIN all; STAFF customer/sales/billing operations and non-sensitive catalog reads;
  CUSTOMER only own portal resources. Catalog writes, tax/discount rules and staff
  creation ADMIN only. Never expose cost prices in customer responses.
- Role checks and ownership filtering on the server, not just navigation visibility.
  No role field accepted in public signup. Signup must not attach an existing
  customer record merely by matching an unverified email.

## Member 1

| Method/path | Input/result |
|---|---|
| POST /auth/signup | {name,email,password} -> PublicUser; customer identity only |
| POST /auth/login | {email,password} -> PublicUser and session cookie |
| POST /auth/logout | Revoke session and clear cookie |
| GET /auth/me | PublicUser, or 401 |
| POST /auth/forgot-password | {email}; generic response; email reset link |
| POST /auth/reset-password | {token,password}; one-time expiring token |
| GET /staff | ADMIN; Page<PublicUser>, query page/pageSize/search |
| POST /staff | ADMIN; {name,email,password} -> 201 PublicUser, role fixed to STAFF |
| GET /dashboard/summary | DashboardSummary from shared/contracts.ts |
| GET /dashboard/overdue | Page<DashboardOverdueInvoice>; same filters plus page/pageSize |

Public auth page routes: /account/login, /account/signup,
/account/forgot-password, /account/reset-password.
Password >=9 chars, uppercase, lowercase, special; normalized unique email.
Use hashed passwords and store token/session hashes, not raw tokens. Reset revokes
sessions. Local file email is an explicit offline demo mode; SMTP is real delivery.
Forgot-password always returns a generic 200 after valid input, including when mail
delivery fails; operations logs contain a fixed diagnostic without email content.
Reset token is 64 lowercase hex characters, valid for 30 minutes, consumed once.
Reset request input is {token,password}; token is carried in the email URL fragment,
not a query parameter. Success clears the browser cookie and all target sessions.
Recovery IP limits: 20 forgot and 30 reset attempts per 15 minutes; email resend
cooldown is 60 seconds per account. Later resends invalidate the previous link.
Portal owners must derive scope using customerIdFor(req) from middleware/auth.ts
and constrain every resource query by that ID. The portal gate rejects unlinked
customer identities even if the role is CUSTOMER. No new portal resources are
implemented by these hours. Shared sendMail({to,subject,text,html?}) in lib/mail.ts
is available for Member 4; do not build a second mail transport or expose outbox files.
Summary: exclude draft/cancelled invoices. Revenue is confirmed/paid pre-tax net
invoiced amount; collected is payments against those invoices; outstanding is
sum of remaining balances; overdue is remaining balances past dueDate. Add date
filters with explicit semantics in step 5 and coordinate optional contract fields.

Implemented dashboard filters: optional `from` and `to` valid YYYY-MM-DD calendar
days (1900-9998), inclusive in Asia/Kolkata, filtering Invoice.issuedAt. Optional
`status=CONFIRMED|PAID`; omitted includes both. Draft/cancelled status filters are
rejected because they cannot contribute to accounting totals. Unknown fields and
reversed ranges are rejected. Summary additionally returns `invoiceCount` and
`asOf` (UTC instant). `activeSubscriptions` is the current ACTIVE count across all
subscriptions, independent of invoice filters. This is not a historical ledger.
Revenue = SUM(subtotalMinor - discountMinor); collected = all recorded payments
against selected invoices, irrespective of paidAt. Balances include tax and clamp
remaining amounts to zero per invoice. Overdue requires dueDate strictly before
asOf and a positive remaining balance. Payment/invoice edits are reflected live;
date filters do not rewind later payments. Revenue and collected are different bases.
Overdue rows expose id, number, customerName, dueDate, totalMinor, paidMinor,
outstandingMinor. Page default 1, max 100000; pageSize default 20, max 100.
Both endpoints are ADMIN/STAFF only, use DB aggregation and stable dueDate/id ordering.
Index migration `20261031090000_dashboard_index` adds Invoice(status,issuedAt).

Hour 6 integration: POST /billing/run now validates a timezone-bearing ISO datetime,
nonempty subscriptionId and maxCatchUpCycles 1-100. Per-subscription API errors are
sanitized; the engine and module-owned lifecycle behavior are preserved.
Payment recording also validates paidAt as a timezone-bearing ISO datetime, method
1-50 chars, note up to 2000, reference up to 200, integer amount 1-2147483647 paise,
and rejects unknown input fields. Existing UI ISO timestamps remain compatible.

## Member 2, under /catalog

GET/POST /products; GET/PATCH /products/:id; POST /products/:id/variants;
PATCH /products/:id/variants/:variantId. Product fields follow schema.prisma.
GET/POST /plans; GET/PATCH /plans/:id. Plan fields include productId, priceMinor,
interval, minimumQuantity, availableFrom/Until and four lifecycle flags.
GET/POST /taxes; PATCH /taxes/:id. GET/POST /discounts; PATCH /discounts/:id.
Use archive/isActive instead of deleting financially referenced data. Validate
date order, product/variant relationships and all monetary/quantity constraints.

## Member 3, under /subscriptions

GET/POST /customers; GET/PATCH /customers/:id.
GET/POST /templates; GET/PATCH /templates/:id.
GET/POST /; GET/PATCH /:id; POST /:id/transition {action}; POST /:id/renew.
Register /customers and /templates BEFORE /:id.
Create input {customerId,planId,startDate,expiryDate?,paymentTermDays,templateId?,lines}.
Line input {productId,variantId?,quantity,unitPriceMinor,taxRuleId?}.
Template input {name,planId,validDays,paymentTermDays,lines}.
Transitions: DRAFT -> QUOTATION -> CONFIRMED -> ACTIVE -> CLOSED.
ACTIVE <-> PAUSED is an additional state controlled by allowPause. Future-dated
confirmed subscriptions activate when their start date arrives. Enforce quotation
validity, plan availability, minimum quantity and lifecycle flags.
Set nextBillingDate on activation. Preserve billingAnchorDay for calendar dates.
Paused subscriptions do not bill; resume schedules from resume date without charging
paused time. Renewal creates a linked-in-description new term with new dates/number;
do not rewrite old invoices. Coordinate precise expiry boundary with billing owner.
Portal GET /portal/subscriptions and /:id; POST /:id/transition and /:id/renew,
allowing only own customerId and plan-permitted customer actions.

## Member 4, under /billing

GET /invoices; GET /invoices/:id; POST /run (ADMIN/STAFF);
POST /invoices/:id/confirm, /cancel, /send;
GET /invoices/:id/print; GET/POST /invoices/:id/payments.
Payment input {method,amountMinor,paidAt,note?,reference?}.
Invoice status DRAFT -> CONFIRMED -> PAID; cancellation must not orphan payments.
Confirm/cancel return balances (paidAmountMinor, remainingBalanceMinor, isOverdue)
as well as the invoice, so action UIs remain usable without reopening the detail.
No payment gateway is required: staff records received payments.
Use unique (subscriptionId,periodStart), transactions and safe discount redemption
to prevent double billing. Billing run and scheduler share one engine. Handle missed
periods on restart with a bounded catch-up batch; do not advance past unbilled periods.
Monthly/yearly intervals use calendar arithmetic with original anchor-day clamping.
Check closed/paused/expired eligibility. Partial payments allowed; overpayment,
payments on draft/cancelled invoices and repeated unique reference rejected.
Portal GET /portal/invoices and /:id and /:id/print; filter by authenticated customerId.
Customer invoice DTOs expose saved invoice/line totals, basic payment dates/methods
and discount labels; they omit staff payment notes/references and internal relations
or rule thresholds. /send returns deliveryMode=file|smtp; file means private local
outbox delivery, not a message in an external inbox. HTML invoice fields are escaped.
Billing selects at most 100 due subscriptions per run, 12 periods per subscription
by default (manual maxCatchUpCycles up to 100). hasMore signals pending catch-up.
The startup/minute scheduler coordinates activation, billing and expiry closure.
Product discount thresholds/savings cover every line for that product, and exact
integer allocation preserves the chosen saving across matching variants/lines.

## Integration hooks

Keep exported router names unchanged. Member 3 exports subscriptionsRouter and
subscriptionPortalRouter; Member 4 exports billingRouter and billingPortalRouter.
Portal child routers use / and /:id; app.ts mounts their prefixes already.
The shared schema contains billing constraints but does NOT implement this behavior.
