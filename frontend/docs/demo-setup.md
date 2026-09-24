# Running the HVAC Warranty demo

The repository has three parts:

| Folder                 | What it is                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/demo-server/` | Node + Express demo API. It holds all demo data (units, registrations, complaints, claims, uploaded files), applies every scoping and permission rule, and owns the seed data and demo accounts. Every window and the phone talk to this one server, so they all see the same state. |
| `frontend/`            | The React web app. It talks to the demo server over HTTP only.                                                                                                                                                                                                                       |
| `shared/wms-domain/`   | Package `@wms/domain`: pure rules both sides need (types, part-wise warranty status and days remaining, entitlement, registration row checks, claim status steps). No scoping, seed data or I/O.                                                                                     |

Demo data is saved in `backend/demo-server/data/` and survives a restart. The sample bulk file is
`demo-assets/coolair_sales_week38.xlsx`.

## 1. First-time setup

You need Node.js 20 or later. Install the shared package first, because the other two link to it.

```bash
cd shared/wms-domain
npm install
cd ../../backend/demo-server
npm install
cd ../../frontend
npm install
```

> **Windows PowerShell:** if `npm` fails with "running scripts is disabled on this system", use `npm.cmd`
> instead of `npm` in every command below, or run
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` once.

## 2. Start the demo

### Option A: one URL (use this for the actual demo)

```bash
cd backend/demo-server
npm run demo
```

This builds the frontend (`npm run build:showcase`: demo accounts on the sign-in page, no environment tag) and
serves the app and the API together on **http://localhost:4000**. Use this for the phone (section 4), because a
tunnel then needs only one port.

### Option B: development (two terminals, live reload)

```bash
# terminal 1
cd backend/demo-server
npm run dev          # API on http://localhost:4000/api

# terminal 2
cd frontend
npm run dev          # app on http://localhost:5173, forwards /api to port 4000
```

Set `PORT` to run the server on another port. The frontend dev server then needs `DEMO_API_URL`, for example
`DEMO_API_URL=http://localhost:4100`.

## 3. Sign in

The sign-in page lists the demo accounts under **Sign in as**. Picking one fills in its email and password. The
list and the password come from the demo server (`GET /api/auth/demo-accounts`); nothing about the accounts is
compiled into the app. The shared password is **`Demo#2026`** if you type it by hand.

| Role         | Login                     | Sees                                                              |
| ------------ | ------------------------- | ----------------------------------------------------------------- |
| Admin        | `admin@demo.wms`          | Everything                                                        |
| Dealer       | `dealer.coolair@demo.wms` | CoolAir Traders' units, registrations, complaints and claims only |
| Distributor  | `dist.northstar@demo.wms` | CoolAir Traders and Breeze Point                                  |
| Customer     | `customer.rk@demo.wms`    | R. Kulkarni's units and complaints (phone layout)                 |
| Dealer (2nd) | `dealer.breeze@demo.wms`  | Breeze Point only                                                 |

**Use a separate browser profile (or a private window, or a different browser) for each role.** The sign-in is
remembered with one cookie per browser profile, so two tabs in the same profile end up as the same user after a
reload. A simple set-up is Chrome for Admin, a Chrome guest window for Dealer, Edge for Distributor, and the phone
for Customer.

## 4. Open the demo on a phone (HTTPS)

The phone's camera (QR scan in W2) only works on an HTTPS page, so the laptop's server has to be reachable over
HTTPS. The simplest way is a temporary tunnel.

### Cloudflare quick tunnel (recommended)

1. Install `cloudflared` once: `winget install --id Cloudflare.cloudflared` (Windows) or
   `brew install cloudflared` (macOS).
2. Start the demo with Option A (`npm run demo`).
3. In another terminal run:

   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```

4. It prints a URL like `https://random-words.trycloudflare.com`. Open that URL on the phone and in every
   laptop window, so the QR labels and all windows use the same address.

The URL changes each time you start the tunnel.

### ngrok (alternative)

With an ngrok account and the agent installed: `ngrok http 4000`, then use the `https://…ngrok-free.app` URL.

### Tunnelling the dev server instead

With Option B you can tunnel the Vite dev server: `cloudflared tunnel --url http://localhost:5173`. Vite already
accepts `*.trycloudflare.com` and `*.ngrok-free.app` hosts. Option A is faster on a phone.

### Before you expose the laptop

- A tunnel URL is public while it runs, and the sign-in page offers the demo accounts to anyone who opens it. Stop the tunnel (Ctrl+C) after the
  demo.
- Check your company's policy on tunnels before using one on a work network or laptop.

## 5. Reset demo data

- **In the app:** Admin → Simulate → **Reset demo data** (the Simulate screen arrives in Phase 3). Until then,
  `POST /api/simulate/reset` as the admin does the same.
- **From the command line**, with the server stopped:

  ```bash
  cd backend/demo-server
  npm run reset
  ```

  This deletes `backend/demo-server/data/` (state, sessions and uploaded files). The next start loads the seed again.

The seed places "expiring soon" and "active" units relative to the day you reset, so reset on the morning of the
demo.

## 6. Other commands

Each of the three folders has `typecheck`, `lint`, `test` and `build` scripts.

| Where                  | Command                       | What it does                                                                                                   |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `backend/demo-server/` | `npm run sample-xlsx`         | Recreates `demo-assets/coolair_sales_week38.xlsx` (25 rows; rows 7, 15 and 22 contain the 3 deliberate errors) |
| `backend/demo-server/` | `npm run build` / `npm start` | Bundles the server into `dist/index.js` and runs it with plain Node (API only)                                 |
| `backend/demo-server/` | `npm test`                    | Seed, scoping, permissions and endpoint tests                                                                  |
| `shared/wms-domain/`   | `npm test`                    | Warranty, entitlement, row-check and claim-step tests                                                          |
| `frontend/`            | `npm test`                    | UI and integration tests. Their MSW mocks run the backend demo core, test-only.                                |
| `frontend/`            | `npm run build:showcase`      | The demo build used by `npm run demo`                                                                          |

## 7. Troubleshooting

| Problem                                    | Fix                                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| `EADDRINUSE` on start                      | Another process uses port 4000: stop it, or set `PORT`. |
| "No frontend build found"                  | Start with `npm run demo` in `backend/demo-server/`.    |
| Signed in as the wrong user after a reload | Two roles share a browser profile; see section 3.       |
| Phone camera doesn't open                  | The page isn't HTTPS: use the tunnel URL (section 4).   |
| Data looks wrong                           | Reset demo data (section 5).                            |
