# AGENTS — operating the Sworna stack

Quickstart for AI agents and anyone automating this repo. The authoritative
runbook is [docs/SETUP.md](docs/SETUP.md); read it before doing anything.

## Roles & the one command each

| Role | Command | Notes |
|---|---|---|
| Central bank | `./scripts/deploy-centralbank.sh --provision` | org1 network + channel + chaincode (approved, not committed) + engine + portal; exports join bundles |
| Add a bank to the channel | `./scripts/onboard-bank.sh Bank{k}MSP <org-json>` | CB host; uses the bank's public org MSP JSON |
| Commit chaincode | `./scripts/commit-chaincode.sh` | CB host, after all banks onboard |
| Bank k | `./scripts/deploy-bank.sh 00k` | own CA + peer + chaincode + owner + portal; needs `SWORNA_CB_HOST` + `SWORNA_OWNER_<NAME>_HOST` |
| Bank peer (low-level) | `BANK_CODE=00k ./scripts/bank-network.sh up\|identity\|join\|down` | identity exports `bank{k}-org.json`; join needs CB onboarding |
| Export bundles | `./scripts/export-join-bundles.sh` | CB host → `dist-bank-bundles/bank<CODE>.tar.gz` |
| Demo | `./scripts/demo.sh` | needs owner1/owner2 running |
| Teardown | `./network/network.sh down` | also `rm -rf token-services/{keys,data} backend/sworna.db dist-bank-bundles` for a full reset |

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