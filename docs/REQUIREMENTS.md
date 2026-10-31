# Source requirements and final acceptance

Source: user-provided Subscription_Management_System.pdf and organizer screenshot.
This checklist is a specification, not a statement that the starter implements it.

- [ ] Unique email; password >8 characters with upper/lower/special; email reset.
- [ ] Admin/staff/customer permissions; only admin adds staff; own customer portal.
- [ ] Products: name, type, sales/cost price, notes; variants and price adjustments.
- [ ] Plans: price, daily/weekly/monthly/yearly, minimum quantity, availability dates.
- [ ] Per-plan auto-close, early-close, pause and renewal permissions.
- [ ] Quotation templates: plan, lines and validity duration.
- [ ] Subscription number/customer/plan/start/expiry/payment terms and priced/taxed lines.
- [ ] Draft -> Quotation -> Confirmed -> Active -> Closed lifecycle.
- [ ] Recurring invoices populate customer/lines/taxes/totals automatically.
- [ ] Confirm/cancel/send/print invoices; Draft -> Confirmed -> Paid.
- [ ] No duplicate or skipped eligible billing periods, including repeated runs.
- [ ] Admin-only fixed/percentage discount rules, thresholds, dates, use limits and scope.
- [ ] Automatic eligible discounts on next invoice; expired/exhausted discounts stop.
- [ ] Payments record method, amount, date, note and invoice; balances/overdue visible.
- [ ] Active subscriptions, revenue, payments and overdue reports with filters/summary.
- [ ] Pages measured under 2 seconds with thousands of database subscriptions.
- [ ] Dynamic persistent data, responsive clean UI, robust validation and navigation.
- [ ] Every member contributes/pushes at least hourly; latest integrated work on main.
- [ ] One repo, no new organization; local/offline demonstration path.

Final demo: admin configures product/variant/plan/tax/discount -> customer account ->
template quotation -> active subscription -> invoice -> repeated run has no duplicate
-> partial/final payment -> own customer portal -> updated reports.
Also verify cross-customer access denial, invalid inputs, expired discounts, forbidden
transitions, persistence after restart, offline behavior and fresh-clone startup.
