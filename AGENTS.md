# AGENTS — operating the Sworna stack

Quickstart for AI agents and anyone automating this repo. The authoritative
runbook is [docs/SETUP.md](docs/SETUP.md); read it before doing anything.

## Roles & the one command each

| Role | Command | Notes |
|---|---|---|
| Central bank | `./scripts/deploy-centralbank.sh --provision --distributed` | network + chaincode + identity enrollment + issuer/auditor + backend + portal + wallet pools; removes bank peers/CAs/chaincode from this host and exports join bundles to `dist-bank-bundles/` |
| Bank A / B | `./scripts/deploy-banka.sh` / `deploy-bankb.sh` | needs its tarball from `dist-bank-bundles/` extracted under the repo root + `SWORNA_CB_HOST` (+ sibling bank IP); brings up its own peer + CA + chaincode + owner + portal |
| Bank peer join | `BANK_NUM=2\|3 ./scripts/bank-network.sh up` | start/join the bank's Fabric peer on its VM |
| Export bundles | `./scripts/export-join-bundles.sh` | tars each bank's join bundle (on the CB) |
| Demo | `./scripts/demo.sh` | needs owner1/owner2 running |
| Teardown | `./network/network.sh down` | also `rm -rf token-services/{keys,data} backend/sworna.db dist-bank-bundles` for a full reset |

## Rules

- **Idempotent by design.** Scripts and provisioning calls can be re-run; the
  identity-enroll and wallet-pool steps only create what is missing. Never fear
  a re-run; fear an unexplained failure.
- **Fresh clones have no identities.** `token-services/keys/` and
  `network/organizations/` are gitignored. The CB deploy script enrolls
  identities automatically — never start the engine manually before
  `token-services/keys/issuer/fsc` exists.
- **Don't restart on `communication service not ready`.** FSC nodes take ~20 s
  to join the auditor bootstrap. Wait and retry the request.
- **Paths are derived.** `backend/app/paths.py` computes all repo paths from the
  file location; do not export `SWORNA_BIN`/`SWORNA_NETWORK_HOME`/
  `SWORNA_FABRIC_CFG`/`SWORNA_TOKEN_SERVICES` unless overriding deliberately.
- **Docker Compose v2 only.** Use `docker compose`, never `docker-compose`.
- **Bank deploys need IPs.** `SWORNA_CB_HOST` (+ sibling bank IP) are required
  for `deploy-banka.sh`/`deploy-bankb.sh` — the cross-host DNS is compose
  `extra_hosts`, not host `/etc/hosts`.

## Verification

Success = the checks in [docs/SETUP.md](docs/SETUP.md) §6 pass. Read
`/tmp/sworna-backend.log` and `/tmp/sworna-web.log` plus `docker logs` on
failure. The deployment is always **distributed** (CB + bank VMs); all-in-one
(no `--distributed`) is dev-laptop testing only. Cross-VM networking is
implemented but not yet validated live — run
[docs/token-network/09-distributed-deployment.md](docs/token-network/09-distributed-deployment.md)
§4 before the demo day.

## Known failure modes → fixes

See [docs/SETUP.md](docs/SETUP.md) §8 (troubleshooting table): missing keys,
missing join bundle, `SWORNA_CB_HOST` unset, compose v2 absent, OOM during
build, "no free wallets", "account not found".