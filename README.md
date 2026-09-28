# fieldpiece-wms

Warranty Management System: the web app (`frontend/`), its API (`backend/`) and the rules they share
(`shared/wms-domain/`).

## Run the whole application

Needs Docker with Compose v2 (Docker Desktop on Windows or macOS, Docker Engine on Linux). On Windows, run the
scripts from **Git Bash**.

```bash
./run.sh          # build and start everything, then open http://localhost:8088
./down.sh         # stop it (data is kept)
```

`run.sh` starts Postgres and Redis, applies the database migrations, loads the starting data the first time (into an
empty database only), then starts the API and the web app. It waits until everything is healthy. Sign in with the
account picker, or with any `@wms.local` account and the password `Demo#2026`.

| Command                         | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `./run.sh`                      | Local stack, built from this checkout (`deploy/env/local.env`)        |
| `./run.sh --no-build`           | Start again without rebuilding                                        |
| `./down.sh`                     | Stop; database and uploaded files are kept                            |
| `./down.sh --purge`             | Stop and delete all data (asks first; `--yes` to skip the question)   |
| `./run.sh --help`, `./down.sh --help` | All options                                                     |

## Cloud: same scripts, different env file

The cloud runs exactly the same stack (`deploy/docker-compose.yml`) with `deploy/env/cloud.env` instead of
`local.env`. Any Linux VM with Docker works (Azure VM, AWS EC2, ...).

1. On the VM: clone the repository and install Docker with the Compose plugin.
2. `cp deploy/env/cloud.env.example deploy/env/cloud.env` and fill in every `change-me`: database passwords, a
   random `AUTH_JWT_SECRET`, and the S3 bucket for uploads. `cloud.env` is git-ignored. `run.sh` refuses to start
   while placeholders are left.
3. `./run.sh cloud` and `./down.sh cloud`.
4. Put the cloud's load balancer (Azure Application Gateway, AWS ALB) or a reverse proxy with TLS in front of
   `WEB_PORT` (80). It must forward `X-Forwarded-Proto`, so session cookies are marked Secure.

Options for real deployments:

- **Images from a registry** instead of building on the VM. Set `IMAGE_REGISTRY` (e.g.
  `myregistry.azurecr.io/hvac-wms`) and `IMAGE_TAG` in `cloud.env`, then `docker login` and run
  `./run.sh cloud --push` in CI or on a build machine. On the VM: `./run.sh cloud --pull`.
- **Managed database** (Azure Database for PostgreSQL, Amazon RDS): `USE_BUNDLED_DB=false` plus `DATABASE_URL` and
  `DATABASE_MIGRATION_URL`. The app role `wms_app` must exist before the first migration
  (see `deploy/postgres/init/01-app-role.sh`).
- **Go-live vs. demo**: the template is set for production (`NODE_ENV=production`, no demo accounts, no starting
  data). For a cloud demo, set `NODE_ENV=staging`, `DEMO_FEATURES_ENABLED=true` and `SEED_DEMO_DATA=true`.

## Layout

```
run.sh, down.sh        start / stop the whole application (local or cloud)
deploy/                docker-compose.yml, env files, web (nginx) image, Postgres init
backend/               API (NestJS + Postgres); README has its development setup and tests
frontend/              web app (React); talks to the API over /api
shared/wms-domain/     warranty, entitlement, registration and claim rules used by both
docs/                  decisions (adr/) and integration notes
```

For day-to-day development with hot reload, run the API and the frontend directly (see `backend/README.md`);
`run.sh` is for running the finished application.
