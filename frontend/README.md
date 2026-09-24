# HVAC Warranty Management: Frontend

Web app for the HVAC Warranty Management demo. Scope, roles, screens and workflows come from
[docs/Demo workflows.md](docs/Demo%20workflows.md), which is the single source of truth. The work plan is in
[docs/implementation-plan.md](docs/implementation-plan.md).

**Stack:** React 18, TypeScript (strict), Vite 8, Tailwind CSS 3.4, Radix UI, TanStack Query/Table, React Router 7,
Zustand, react-hook-form + zod, Recharts, i18next, MSW, Vitest, Playwright.

## Getting started

See [docs/demo-setup.md](docs/demo-setup.md). In short, with `shared/wms-domain` and `backend/demo-server`
installed:

```bash
cd backend/demo-server && npm run dev   # demo API on http://localhost:4000/api
cd frontend && npm run dev              # app on http://localhost:5173 (forwards /api)
```

In development the sign-in page offers the demo accounts (**Sign in as**), loaded from the demo server.

## Scripts

| Script                       | What it does                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                | Dev server; `/api` goes to the demo server on port 4000                                        |
| `npm run build`              | Type-check and production build                                                                |
| `npm run typecheck`          | `tsc -b` only                                                                                  |
| `npm run lint`               | ESLint, zero warnings allowed                                                                  |
| `npm run format`             | Prettier (sorts Tailwind classes)                                                              |
| `npm test` / `test:coverage` | Vitest unit + component tests (coverage gates on transitions, warranty maths, formatters)      |
| `npm run e2e`                | Playwright at 1440px and 375px with an axe scan (first run: `npx playwright install chromium`) |

Husky runs lint-staged on commit and checks commit messages against Conventional Commits
(`feat(claims): add reject modal`). The existing `WMS-123: ...` ticket style is also accepted.

## Layout

```
src/
├── app/            providers, router, RequireRole, layouts
├── components/
│   ├── ui/         design-system primitives (Button, FormField, SerialNumberInput, DataTable, Modal, ...)
│   ├── layout/     AppShell, TopBar, AppHeader, Sidebar, PageHeader, AuthLayout, ScaffoldPage
│   └── feedback/   EmptyState, ErrorState, Skeleton, Toast
├── features/<name>/ api.ts · hooks.ts · schemas.ts · types.ts · components/ · pages/
├── lib/            http (axios), query client, session, permissions, warranty maths, formatters, i18n
├── locales/        en / es / fr strings
├── test/           test setup; mocks/ = test-only MSW adapter over the backend demo core
├── styles/         tokens.css (the ONLY place hex values live), globals.css
└── types/          shared domain + API types
```

## Rules the tooling enforces

- **No raw hex colours** in TS/TSX. Use tokens (`bg-brand-500`). ESLint fails the build otherwise.
- **Features don't import each other's internals** (`@/features/x/...` is blocked inside `features/`). Shared code
  goes in `components/`, `lib/` or `types/`.
- **No default exports**, except route pages. **No `any`.**
- **Claim actions come only from `features/claims/transitions.ts`.** Don't hard-code status checks in components.
- **Tokens stay in memory.** Never put an access token in `localStorage`.
- **UI hiding isn't security.** `lib/permissions.ts` and `RequireRole` only decide what to show; the API enforces access.

## Notes

1. **Status colours.** `success-bg` and `warning` in `tokens.css` were darkened so badges pass WCAG AA (4.5:1).
2. **`globals.css`** imports `tokens.css` before the `@tailwind` directives (PostCSS requires `@import` first).
3. **Opacity modifiers** such as `bg-ink-900/60` don't work on CSS-variable colours in Tailwind 3, so `scrim` and
   `tint` tokens were added for overlays.
