# Running the HVAC Warranty demo

**Supported browser: Google Chrome only** (Chrome on the laptop, Chrome on the phone). Other browsers aren't tested.

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

**Use a separate Chrome profile for each role.** The sign-in is remembered with one cookie per browser profile, so
two tabs in the same profile end up as the same user after a reload. Create the profiles once (Chrome → profile
icon at the top right → **Add** → "Continue without an account"), named Admin, Dealer, Distributor and Customer.
Use the Customer profile only if you show the customer screens on the laptop; normally the customer is the phone.

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

- **In the app (use this):** sign in as Admin → **Administration** → **Simulate** tab → **Reset demo data** →
  confirm. Everyone stays signed in; every screen shows the starting data again.
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

| Where                  | Command                       | What it does                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/demo-server/` | `npm run sample-xlsx`         | Recreates `demo-assets/coolair_sales_week38.xlsx` (25 rows; rows 7, 15 and 22 contain the 3 deliberate errors)                                                                                                                                                                                    |
| `backend/demo-server/` | `npm run build` / `npm start` | Bundles the server into `dist/index.js` and runs it with plain Node (API only)                                                                                                                                                                                                                    |
| `backend/demo-server/` | `npm test`                    | Seed, scoping, permissions and endpoint tests                                                                                                                                                                                                                                                     |
| `shared/wms-domain/`   | `npm test`                    | Warranty, entitlement, row-check and claim-step tests                                                                                                                                                                                                                                             |
| `frontend/`            | `npm test`                    | UI and integration tests. Their MSW mocks run the backend demo core, test-only.                                                                                                                                                                                                                   |
| `frontend/`            | `npm run build:showcase`      | The demo build used by `npm run demo`                                                                                                                                                                                                                                                             |
| `frontend/`            | `npm run e2e`                 | Playwright (Chromium): one spec per workflow W1–W7, every screen's "must contain" list, and an accessibility scan. Starts its own demo server on port 4100 and app on 5174 with throwaway data, so it doesn't touch the demo data on port 4000. Run `npx playwright install chromium` once first. |

## 7. Demo day

Follow this order on the morning of the demo. It is the pre-demo checklist in `docs/Demo workflows.md`, spelled out.

1. **Start the server** (laptop): `cd backend/demo-server` → `npm run demo`. Wait for "Demo app on
   http://localhost:4000".
2. **Start the tunnel** for the phone (section 4): `cloudflared tunnel --url http://localhost:4000`. Note the
   `https://…trycloudflare.com` address. Use this address in **every** window below, not `localhost`, so the QR
   labels point to the address the phone can open.
3. **Open the four Chrome profiles** (section 3) at the tunnel address and sign in:

   | Chrome profile | Sign in as                          | Window size                 |
   | -------------- | ----------------------------------- | --------------------------- |
   | Admin          | Admin: WMS office admin             | Full screen (desktop)       |
   | Dealer         | Dealer: CoolAir Traders, Pune       | Desktop or tablet width     |
   | Distributor    | Distributor: NorthStar Distribution | Desktop                     |
   | Customer       | Customer: R. Kulkarni               | Only if not using the phone |

4. **Reset demo data** in the Admin window: Administration → Simulate → **Reset demo data** → confirm. Do this last,
   after signing in, so counts start clean. The seed dates units from the day you reset.
5. **Phone:** open Chrome at the tunnel address, sign in as **Customer: R. Kulkarni**, and allow the camera when asked
   (the first QR scan asks once). Keep a fault photo in the phone's gallery for W3.
6. **QR label for W2:** in the Admin window open **Units** → `AER-SPL15-240917` → **Print label** (or keep that page
   on screen for the phone to scan).
7. **Bulk file for W1:** keep `demo-assets/coolair_sales_week38.xlsx` ready on the Dealer laptop.
8. **Run order:** W1, W2, W3, W4, W6, W5, W7 (`docs/Demo workflows.md`). Nothing else needs resetting between
   workflows.

**The failed row in the Integration log is on purpose.** The seed includes one outbound **CRM update that failed**
("CRM did not respond within 30 s."). It is there so you can show **Retry** in W6 step 4: open Administration →
Integration log, find the row with status **Failed**, click **Retry**; it changes to **Sent** and its attempt count
goes up. A reset puts the failed row back.

After the demo: stop the tunnel (Ctrl+C) and the server.

## 8. Troubleshooting

| Problem                                    | Fix                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EADDRINUSE` on start                      | Another process uses port 4000: stop it, or set `PORT`.                                                                                                                        |
| "No frontend build found"                  | Start with `npm run demo` in `backend/demo-server/`.                                                                                                                           |
| Signed in as the wrong user after a reload | Two roles share a browser profile; see section 3.                                                                                                                              |
| Phone camera doesn't open                  | The page isn't HTTPS: use the tunnel URL (section 4). If Chrome blocked it, tap the lock icon → Permissions → Camera → Allow, or type the serial in the box under the scanner. |
| Something looks wrong in another browser   | Only Chrome is supported. Open the demo in Chrome.                                                                                                                             |
| Data looks wrong                           | Reset demo data (section 5).                                                                                                                                                   |
