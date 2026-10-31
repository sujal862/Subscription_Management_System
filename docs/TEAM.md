# Four-person workflow

## Ownership

| Member | Own frontend | Own backend | Full responsibility |
|---|---|---|---|
| 1 | features/auth, features/staff, features/dashboard | modules/auth, modules/staff, modules/dashboard | Foundation, access, dashboard and integration |
| 2 | features/catalog | modules/catalog | Products/variants, plans, taxes, discounts |
| 3 | features/subscriptions | modules/subscriptions | Customers, quotation templates, lifecycle, subscription portal |
| 4 | features/billing | modules/billing | Recurring billing, invoices, payments, invoice portal |

Every member owns their module's frontend, backend and validation. Use the schema
and API contract as the common interface; do not generate a second app.
Leader coordinates shared files listed in AGENTS.md. Do not all edit routing,
schema, package-lock or global CSS independently. Put module CSS next to your pages.
The starting data model is a contract, not proof that the business behavior exists.

## Before the first prompt

1. Leader adds the other three GitHub usernames as repository collaborators in
   Settings > Collaborators, and they accept. No usernames have been assumed.
2. Everyone configures their own Git name/email matching their GitHub account.
3. Everyone clones, runs npm ci and npm run setup, then creates their own branch.
4. Assign the module numbers and a shared integration clock.
5. Give the agent only the next prompt from the member's file. Do not send all six.

## Every 40-45 minutes

Commit a meaningful working increment and push personally before the one-hour limit.
One integration slot at a time:

```sh
git status
git add <your-changed-files>
git commit -m "feat(catalog): describe this working increment"
git fetch origin
git merge origin/main
npm run db:deploy
npm run check
git push
```

Use your actual files and module name; do not paste angle-bracket placeholders.
Resolve conflicts by preserving both modules' behavior. If main changed again,
fetch/merge and recheck before the merge. Never force-push.

Open a PR from your work branch to main. Another member reviews the change and
the leader coordinates the merge. Use merge commits to preserve history with
these reusable work branches. Everyone fetches/merges main after each cycle.
Do not wait until the final hour to integrate four independent applications.
Keep main current and runnable throughout; a branch push alone is not integration.

If the organizer literally allows only main: skip remote working branches and PRs.
Each member commits locally on main; during an assigned push slot, fetch and merge
origin/main, resolve conflicts, check, then push. Repeat for the next person.
Never let multiple agents push to main at once.

## Hourly dependencies

- Hour 1: Member 1 ships real sessions and requireAuth/requireRole first. Until
  merged, other members test their routers in isolated test apps, not by bypassing
  gates or creating fake admin sessions in the shared application.
- Member 2 supplies product/plan selection APIs before subscription UI integration.
- Member 3 supplies valid active subscriptions before recurring billing integration.
- Member 4 supplies invoice/payment behavior before Member 1 finishes financial cards.
- Portal routers are already split: subscriptionPortalRouter belongs to Member 3,
  billingPortalRouter belongs to Member 4. No shared portal file needs editing.

## Six steps and a final buffer

The six prompts are sequential scopes, not promises to spend exactly one hour
generating code. If a step is ready sooner, integrate it immediately. Continue
useful checking and explanation; do not fabricate commits to match a clock.
Preserve the final 30-60 minutes for integrated fixes and submission. If time runs
short, cut decorative additions first and disclose any missing required behavior.

Each handoff includes changed files, checks, API/schema changes, limitations and
what is next. The human verifies the code and pushes; the agent should not jump
ahead into future hourly prompts.
