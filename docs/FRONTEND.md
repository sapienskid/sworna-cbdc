# Frontend — the three-portal React app

`web/` is a single React codebase that builds **three portals** (central bank,
bank staff, customer wallet) and can also be served as one app. Design
language: **shadcn/ui, monochrome (neutral) palette, Geist font** — no brand
colors; the only non-grayscale accents are semantic status colors (destructive
badges, warning banners).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite 5 + TypeScript | fast dev loop, per-portal env builds |
| Routing | react-router-dom 6 | real URLs per page (deep links, refresh-safe) |
| UI | shadcn/ui + Radix (`radix-ui`), Tailwind 4 (CSS-first config in `src/index.css`) | accessible primitives, tokens/theming, monochrome by default |
| Forms | react-hook-form + zod | typed validation at the boundary |
| Toasts | sonner | minimal, consistent |
| Charts | hand-rolled SVG (`src/components/kit.tsx`) | grayscale bar list + sparkline without a chart dependency |
| QR | `qrcode.react` | real account QR in the wallet |
| Data | thin `fetch` wrapper in `src/lib/api.ts` | no state library needed at this size |

## Portals and routes

| Route | Portal | Pages |
|---|---|---|
| `/login` | shared | role-aware login (redirects by role) |
| `/cb` | Central bank console | `dashboard` (M0 KPIs, mint/allocate/burn, reserves) · `banks` (registry, provisioning, permissions) · `ledger` (ledger monitor + transactions) · `compliance` (AML) · `privacy` (zk params + wallet credentials) · `administration` (CB staff RBAC) |
| `/b/:code` | Bank staff console | `overview` (reserve KPIs, cash-in/cash-out, transfers) · `accounts` (registry, freeze, CSV) |
| `/b/:code` (customer role) | Customer wallet | balance card, send, receive (QR), cash out, statements |

Guards: `RequireAuth` + role checks in `src/App.tsx`. CB roles are
`cb_admin`, `cb_mint_officer`, `cb_auditor`; bank roles `bank_staff` /
`bank_admin` are confined to `user.bank_code`; customers to their account.
The customer wallet is role-rendered inside `/b/:code`, not a separate route.

Per-portal builds: `.env.portal-*` sets `VITE_DEFAULT_PORTAL`
(`cb` / `banka` / `bankb`) which changes the fallback route; artifacts land in
`dist-cb/`, `dist-banka/`, `dist-bankb/`. In production FastAPI serves
`web/dist` (SPA fallback in `backend/app/main.py`); in dev Vite proxies `/api`
to `:8000`.

## Key files

```
web/src/
├── App.tsx                  # routes + guards + portal shells (nav is URL-based)
├── components/
│   ├── app-shell.tsx        # sidebar (grouped nav), topbar (UTC clock, live badge, dark toggle), user footer
│   ├── kit.tsx              # StatCard, BarList, Sparkline (grayscale), used by dashboards
│   └── ui/                  # shadcn primitives (+ our switch)
├── lib/
│   ├── api.ts               # typed API client; 401 → auto-logout; error detail extraction
│   ├── auth.tsx             # AuthContext (login/logout/me), token in localStorage
│   └── format.ts            # SWR/date formatting, tx-type labels, CSV export
└── pages/
    ├── login.tsx            # two-panel login, no credentials on screen
    ├── customer.tsx         # wallet card, real QR, statements
    ├── cb/{dashboard,banks,ledger,compliance,privacy,administration}.tsx
    └── bank/dashboard.tsx   # overview + accounts tabs
```

## Conventions

- **Polling, not websockets**: dashboards refresh every 30–60 s via
  `setInterval` + explicit Refresh buttons (good enough for demo latency; a
  WS/SSE feed is a Phase-4 candidate).
- **Money**: the API returns SWR major units as strings; all rendering goes
  through `fmtSwr` (`en-IN` grouping, 2 decimals). Statement rows carry minor
  units and divide by 100 at the API boundary.
- **Tables**: `shadcn/ui` Table inside cards with `overflow-x-auto` — wide
  tables scroll within their card, the page itself never overflows
  (`SidebarInset` carries `min-w-0 overflow-x-hidden`; don't remove it).
- **Status colors**: semantic only (`destructive` for flagged/burn,
  `outline`/`secondary` otherwise).
- **Dark mode**: class-based (`.dark` on `<html>`), toggled in the topbar,
  persisted in `localStorage("sworna_theme")`.
- The login screen shows **no credentials** — demo credentials live in
  [DEMO_AND_UI_GUIDE.md](DEMO_AND_UI_GUIDE.md) only.
