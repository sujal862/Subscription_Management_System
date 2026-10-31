# Team instructions for every coding agent

This is a seven-hour hackathon project. The initial commit is SCAFFOLD ONLY.
Do not implement the whole application or a whole member's assignment in one turn.
Implement only the current hourly prompt and leave future steps for later turns.

Read README.md, docs/TEAM.md, docs/API_CONTRACT.md and your member prompt file first.
Member 1: foundation, auth, permissions, staff, dashboard, integration.
Member 2: client/src/features/catalog and server/src/modules/catalog.
Member 3: client/src/features/subscriptions and server/src/modules/subscriptions.
Member 4: client/src/features/billing and server/src/modules/billing.

Shared files (leader coordinates): package.json, package-lock.json, prisma/**,
shared/**, server/src/app.ts, server/src/middleware/**, server/src/lib/**,
client/src/App.tsx, client/src/components/**, client/src/styles.css, scripts/**,
CI and this file. Propose shared changes before independently altering contracts;
the leader can authorize them in the current prompt. Keep module styles in module folders.

Use pinned dependencies and npm ci. Do not upgrade the stack during feature work.
Use real database operations; no final static business JSON or fake successful APIs.
Never weaken auth gates to make a module work. Pending APIs must return 501.
Enforce authorization, customer ownership, validation and monetary calculations on the server.
No secrets, local DBs, node_modules or generated builds in commits.
Every member commits and pushes their own work; never impersonate another member.
Never force-push or automatically discard a side of a merge conflict.
Run npm run check before handoff; add focused behavior tests for new business logic.
Replace relevant starter-only 501 assertions when implementing those endpoints;
add module tests separately to avoid multiple owners editing the same test file.
Summarize changed files, API/schema changes, checks and remaining work.
Do not commit or push hourly feature work unless the user asks; the user plans to push it.
Do not spawn other agents unless the user explicitly requests delegation.
