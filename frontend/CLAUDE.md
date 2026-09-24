# CLAUDE.md: HVAC Warranty demo frontend

## Source of truth

- `docs/Demo workflows.md` is the only source of truth for scope, roles, screens (A01–A13, DL01–DL07, CU01–CU05),
  statuses, seed data and workflows (W1–W7).
- `docs/implementation-plan.md` is the agreed plan. Follow it phase by phase.
- `docs/FE_Requirements_Gap_Report.md` describes the code as it was before the rebuild. Use it to see what is reusable.
- Ignore `FIELDPIECE_WARRANTY_FRONTEND_INSTRUCTIONS.md`. Code comments that say "Section x.y" refer to that old brief.
- Out of scope, don't build: technician app, inventory, budget, AMC, compliance, offline mode.

## Visual design is frozen

The existing look must stay exactly as it is. Only features and behaviour change.

- Don't change: `src/styles/*` (tokens, globals), `tailwind.config.ts`, `postcss.config.js`, fonts, logo, favicon,
  colours, spacing, radius, shadows, the icon set (lucide-react), or the app shell (`AppShell`, `AppHeader`, `TopBar`,
  `Sidebar`, `AuthLayout`, `RootLayout`, `Logo`).
- Don't change how anything in `src/components/ui/*` looks. Adding a non-visual prop needs approval first.
- Don't add UI or styling libraries.
- Build new screens by composing existing components from `src/components/{ui,layout,feedback}`. Copy the structure and
  class names of the most similar existing page: `ClaimsListPage` (lists), `ClaimDetailPage` (details),
  `NewRegistrationPage` / `NewClaimPage` (forms and steppers), `ProductsPage` (card grids),
  `ClaimsByStatusChart` (charts).
- Use only Tailwind classes and colour tokens that already appear in `src/`. Check with a search before using one.
- Status colours come only from `src/components/ui/status-styles.ts` via `StatusBadge`. Add new statuses there by
  reusing an existing colour variant.
- If a needed UI element has no existing equivalent, build it from existing primitives and classes, and ask before
  adding it.
- Text changes (for example removing Fieldpiece wording) are fine. Visual changes aren't.
- `nav-items.ts` is data (routes, roles, labels) and may change. Its icons must come from lucide-react.

## Code rules

- No hardcoded UI strings. Every string goes in `src/locales/en.json`, including Zod messages for new code.
- Add unit tests for business logic: per-part warranty status, entitlement, validation, scoping and status transitions.
- Status transitions live in one place per entity (the `features/claims/transitions.ts` pattern).
- Access tokens stay in memory only. Scoping is enforced by the demo server, not only by the UI.
- Local drafts go through `src/lib/drafts.ts` (per-user keys, cleared on sign-out).

## Process

- Work on branch `demo-workflows`.
- After each phase: run `npm run typecheck`, `npm run lint` and `npm test` (all must pass), then stop with a short
  summary (what changed, what to click to check it) and wait for approval before the next phase.
- Before each commit, check the diff. If any file in the "visual design is frozen" list changed, undo it.
  `git diff --quiet e51b09e -- src/styles tailwind.config.ts src/components/layout src/assets public/favicon.svg`
  must succeed (`nav-items.ts` is the one allowed exception in `src/components/layout`).
- Commit messages must pass `.husky/commit-msg`: use `WMS-<n>: <summary>`, for example
  `WMS-004: Phase 1: demo server and seed data`.
