# AGENTS — operating the Sworna stack

Quickstart for AI agents and anyone automating this repo. The authoritative
runbook is [docs/SETUP.md](docs/SETUP.md); read it before doing anything.

## Roles & the unified commands

| Role | Unified CLI Command | Script Fallback | Notes |
|---|---|---|---|
| **Unified E2E Verification** | `./bin/sworna test e2e` | - | Automated end-to-end verification (mint, interbank ZKP transfer, balances) |
| **Central bank** | `./bin/sworna cb init --provision` | `./scripts/deploy-centralbank.sh --provision` | Orderer + Central Bank Peer + CAs + Issuer/Auditor + Backend (:8100) + Portal (:5273) in Docker |
| **Add a bank (one step)** | `./scripts/add-bank.sh 00k [<BANK-VM-IP>]` | - | **run on the CB host**; registers, provisions, syncs repo, onboards to channel, commits chaincode |
| **Commercial Bank (VM)** | `./bin/sworna bank init --code 00k --cb-host <IP>` | `BANK_CODE=00k ./scripts/bank-network.sh identity` | Generates local MSP keys; exports `bank{k}-org.json` for CB approval |
| **Bank Start (VM)** | `./bin/sworna bank start --code 00k --cb-host <IP>` | `BANK_CODE=00k ./scripts/bank-network.sh up\|join` | Joins settlement channel, starts FSC owner engine |
| Commit chaincode only | `./scripts/commit-chaincode.sh` | - | CB host; normally already done by add-bank.sh |
| Export bundles | `./scripts/export-join-bundles.sh` | - | CB host → `dist-bank-bundles/bank<CODE>.tar.gz` |
| Teardown | `./bin/sworna cb down` | `./network/network.sh down` | Teardown CB containers and channel |

Host IPs of onboarded banks live in `network/bank-hosts.env` (written by
add-bank.sh); all deploy scripts source it as a fallback, so
`SWORNA_OWNERS` / `SWORNA_OWNER_<NAME>_HOST` env vars are optional now —
explicit env still wins.

## Rules

- **Idempotent by design.** Scripts and provisioning calls can be re-run; the
  identity-enroll and wallet-pool steps only create what is missing. Never fear
  a re-run; fear an unexplained failure.
- **Fresh clones have no identities.** `token-services/keys/` and
  `network/organizations/` are gitignored. The CB deploy enrolls the CB's own
  identities automatically — never start the engine before
  `token-services/keys/issuer/fsc` exists.
- **Banks self-provision their Fabric org** (peer/admin keys never leave their
  VM). The CB mints their **token wallets** (token CA is the idemix issuer —
  inherent to the token-SDK trust model).
- **Deploy order matters:** CB → bank `identity` (exports org JSON) →
  `onboard-bank.sh` → bank `join` → `commit-chaincode.sh`.
- **Don't restart on `communication service not ready`.** FSC nodes take ~20 s
  to join the auditor bootstrap. Wait and retry the request.
- **Paths are derived.** `backend/app/paths.py` computes repo paths; owner REST
  URLs derive from the owner node name (`app/owner_urls.py`). Do not export
  `SWORNA_BIN`/`SWORNA_NETWORK_HOME`/`SWORNA_FABRIC_CFG`/`SWORNA_TOKEN_SERVICES`
  unless overriding deliberately.
- **Docker Compose v2 only.** Use `docker compose`, never `docker-compose`.
- **Cross-host DNS** is generated `extra_hosts` + `/etc/hosts` (bank host:
  `orderer.sworna.example.com` → CB IP; CB host: `owner{k}.sworna.example.com`
  → bank IP). A blank `/etc/hosts` breaks everything — verify `localhost`.

## Verification

Success = the checks in [docs/SETUP.md](docs/SETUP.md) §7 pass. Read
`/tmp/sworna-backend.log` and `/tmp/sworna-web.log` plus `docker logs` on
failure. The deployment is always **distributed** (CB + bank VMs); cross-VM
networking is implemented but not yet validated live — run
[docs/token-network/09-distributed-deployment.md](docs/token-network/09-distributed-deployment.md)
§6 before the demo day.

## Known failure modes → fixes

See [docs/SETUP.md](docs/SETUP.md) §9 (troubleshooting table): missing keys,
missing join bundle, `SWORNA_CB_HOST` unset, "not onboarded", blank `/etc/hosts`,
OOM during build, "no free wallets", "account not found".