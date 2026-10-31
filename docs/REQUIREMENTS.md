# Source requirements and final acceptance

Source: user-provided Subscription_Management_System.pdf and organizer screenshot.
Final implementation evidence and remaining operational limits are recorded in
[FINAL_REVIEW.md](FINAL_REVIEW.md). Checked items reflect the tested local workflow.

- [x] Unique email; password >8 characters with upper/lower/special; email reset (file/SMTP transport; real provider remains configuration-dependent).
- [x] Admin/staff/customer permissions; only admin adds staff; own customer portals.
- [x] Products: name, type, sales/cost price, notes; variants and price adjustments.
- [x] Plans: price, daily/weekly/monthly/yearly, minimum quantity, availability dates.
- [x] Per-plan auto-close, early-close, pause and renewal permissions.
- [x] Quotation templates: plan, lines and validity duration.
- [x] Subscription number/customer/plan/start/expiry/payment terms and priced/taxed lines.
- [x] Draft -> Quotation -> Confirmed -> Active -> Closed lifecycle.
- [x] Recurring invoices populate customer/lines/taxes/totals automatically.
- [x] Confirm/cancel/send/print invoices; Draft -> Confirmed -> Paid (offline outbox for local send, browser PDF for print).
- [x] No duplicate or skipped eligible billing periods in tested repeated/concurrent runs; bounded backlog catch-up.
- [x] Admin-only fixed/percentage discount rules, thresholds, dates, use limits and scope.
- [x] Automatic eligible discounts on next invoice; expired/exhausted discounts stop.
- [x] Payments record method, amount, date, note and invoice; balances/overdue visible.
- [x] Active subscriptions, revenue, payments and overdue reports with filters/summary.
- [x] Representative desktop/mobile pages measured under 2 seconds with 3,001 subscriptions; API tests also cover 6,000+ records.
- [x] Dynamic persistent data, responsive clean UI, robust validation and navigation in tested routes.
- [ ] Every member contributes/pushes at least hourly; latest integrated work on main.
- [x] One repo, no new organization; local/offline demonstration path.

Final demo: admin configures product/variant/plan/tax/discount -> customer account ->
template quotation -> active subscription -> invoice -> repeated run has no duplicate
-> partial/final payment -> own customer portal -> updated reports.
Also verify cross-customer access denial, invalid inputs, expired discounts, forbidden
transitions, persistence after restart, offline behavior and fresh-clone startup.
