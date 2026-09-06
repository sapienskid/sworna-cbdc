# Execution Status & Handoff — Distributed Scaling Plan (2026-09-06)

Live status of [2026-09-06-distributed-scaling-implementation-plan.md](2026-09-06-distributed-scaling-implementation-plan.md).
This file is the handoff point: **read this before touching anything.**

## Hosts & access

| Node | Address | Access | Notes |
|---|---|---|---|
| Workstation (repo) | `/run/media/sapiens/Development/CBDC` | — | git remote `sapienskid/sworna-cbdc`, branch `main` |
| Central Bank `centralCBDC` | `100.72.112.29` (LAN 192.168.19.69) | `ssh sapiens@…` key auth works; **sudo password `sabin`** (the plan's `sapiens` is wrong) | repo at `/home/sapiens/sworna-cbdc`; user in `docker` group |
| Bank 2 `bankpt` | `100.111.120.73` | password `bankpt`, user `bankpt`; **no sshpass on workstation** — use askpass helper (below) | repo at `/home/bankpt/sworna-cbdc` |
| Bank 1 `bankpp` | `100.72.65.13` (LAN 192.168.19.52) | **BLOCKED** — Tailscale SSH policy refuses (node shared from `clashroyale11288@` tailnet; cannot edit ACL from our tailnet), LAN port 22 firewalled from workstation *and* CB host. Console password `shubheeksha` (user probably `sapiens`) | all service ports closed (9200 etc.) — whole stack down |

SSH helper for password hosts (no sshpass installed):

```bash
cat > /tmp/sworna-askpass.sh <<'EOF'
#!/bin/bash
echo "$SWORNA_SSH_PASS"
EOF
chmod +x /tmp/sworna-askpass.sh
SWORNA_SSH_PASS=bankpt SSH_ASKPASS=/tmp/sworna-askpass.sh SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh bankpt@100.111.120.73 'command'
```

CB API login: `cbadmin` / `sworna-cb` on `http://100.72.112.29:8100/api/v1`.
Bank 002 portal staff login: `bank2_admin` / `sworna-bank`.

## Phase status

### Phase 1 — CB clean-up & Dockerization: ✅ DONE
- `sworna-backend`/`sworna-web` systemd units stopped, disabled, **deleted** on CB
  (done via `docker run --privileged --pid=host alpine nsenter -t 1 …` because the
  plan's sudo password was wrong; `sabin` works for normal sudo).
- `chown -R sapiens:sapiens /home/sapiens/sworna-cbdc`; `sworna.db` is 664.
- Stack healthy: backend :8100 `/healthz`, web :5273 (200), token CA :27054,
  auditor :9000, issuer :9100, orderer/peer/CAs up 19h+.

### Phase 2 — Auto-replenishing wallet pool: ✅ DONE & VERIFIED (commit `1b09f63`)
- `backend/app/provisioning.py`: `replenish_wallet_pool()` + `assign_wallet(threshold=5, batch=25)`.
  Replenish also deletes `dist-bank-bundles/bank{code}.tar.gz` (stale-bundle fix) and
  syncs `OnboardingApplication.pool_size`.
- `bank-docker.sh` now fetches live `POOL_SIZE` from the CB before rendering owner conf.
- **Live proof**: bank 001 pool 10→50 wallets, 30 assigned in a loop, no errors.

**Gotchas found on the way (both fixed on CB host, not in git):**
1. Stale token-CA admin enrollment (`token-services/.ca-client/msp`, from Aug 22, CA
   restarted Sep 5) made *every* CA call fail with `Error Code: 20 - Authentication failure`.
   Fixed by `rm -rf token-services/.ca-client/msp`; provisioning re-enrolls automatically.
2. Bank 002's approval-time provisioning had **silently failed** during that stale-CA
   window: no `fscowner2` CA identity, zero `pool_002_*` wallets, empty keystore dir
   packed into its join bundle (owner2 crash-looped on missing
   `fsc/msp/signcerts/cert.pem`). Fixed by re-running `provision_wallet_pool(bank002)`
   in a Python shell on CB + deleting the stale bundle + re-running
   `./scripts/bank-docker.sh up 002 100.72.112.29 100.111.120.73` on bankpt.

### Phase 3 — Tailscale discovery: ✅ DONE (commit `1b09f63`)
- `bank-docker.sh` MY_HOST detection order: Tailscale MagicDNS name → `tailscale ip -4`
  → route-src → default route → `hostname -I`.

### Phase 4 — Bank 2 join: ✅ DONE (with 2 extra bug fixes)
- bankpt cleaned (killed stale `uvicorn :8000`, `npm run dev`/vite/esbuild; there were
  no stale docker containers). Self-kill trap: use `pkill -9 -f "[u]vicorn …"` bracket
  patterns or pkill kills the ssh remote shell itself.
- Join re-run; bank 002 live: web :5173 `200`, owner2 :9300 `/healthz` ok,
  `peer0.bank2` + `ca_bank2` up.
- **Fix committed `5e1c951`**: in bank mode `gen-net-overrides.py` mapped *every*
  `owner{k}`/`peer0.bank{k}` to the CB IP when per-owner env was unset — including the
  bank's own peer (delivery conn refused). `bank-docker.sh` now exports
  `SWORNA_OWNER_<SELF>_HOST=$MY_HOST` and per-bank hosts from the CB
  `/onboarding/applications` registry.
- **Manual fix on CB host (not scripted yet)**: issuer/auditor confs had been rendered
  before owner certs existed → resolvers contained *only* the auditor. Re-rendered with
  `SWORNA_OWNERS="owner1 owner2"` and **`set -a; source network/bank-hosts.env; set +a`**
  (plain `source` does NOT export → render falls back to 127.0.0.1 — classic trap),
  regenerated `token-services/docker-compose.net.yaml`, recreated issuer+auditor.
  → **TODO for next agent: fold this re-render into `bank-docker.sh`/onboarding approve
  path so adding bank N updates the CB issuer/auditor confs automatically.**

### Phase 5 — Bank 1: ⛔ BLOCKED (see access table). Owner1 :9200 down with the whole stack.

### Phase 6 — E2E: 🔶 IN PROGRESS — one root cause left
Current failure: CB mint → `502 token service error: can't issue tokens`. Chain fixed so far:

1. ~~issuer conf had no owner resolvers~~ → fixed (re-render, above).
2. ~~FSC v0.3.0 `P2PNode.sendTo` only programs the libp2p peerstore when the endpoint
   address starts with `/ip4/`; resolver confs carry `host:port`, so every cross-VM dial
   failed `no addresses` (and `/ip4/` form fails `AddressToEndpoint` instead — the
   v0.3.0 code is broken both ways; DHT is client-mode so it can't rescue).~~
   **Fixed by build-time Dockerfile patch** (commits `4be19b6`→`3b68829`→`953c21b`):
   line-addressed `sed -i -e '15d' -e '192s/.*/\tif len(address) != 0 {/'` on
   `fabric-smart-client@v0.3.0/platform/view/services/comm/p2p.go`
   (line 192 = the `strings.HasPrefix` condition; line 15 = `"strings"` import which
   becomes unused → compile error). Pattern-based sed did NOT match in the docker build
   env — don't retry it, line numbers are pinned by go.sum.
   ⚠️ Only the **issuer** image is rebuilt on CB. **Auditor + bank owner images still
   need `--build`** (owner2 as responder also dials out for audit).
3. ✅ Patch confirmed working: issuer now dials owner2 (`reprogram address` in logs, P2P OK).
4. ❌ **Current blocker**: owner2 answers the recipient-identity request with
   `wallet [pool_002_w1:mynetwork,settlement,tokenchaincode] not found`. Debug logs:
   `[AnonymousIdentity] cannot find match for string [pool_002_w1]`,
   `identifier for [pool_002_w1] is [<empty>,pool_002_w1]`,
   `no wallet found for [<empty>] at [pool_002_w1]`.
   The idemix owner wallets are **never registered at startup** — no "Load Idemix
   Wallets" log ever appears; only `Load x509 Wallets: [[]]` (×6). Conf
   (`token-services/owner/conf/owner2/core.yaml`, mounted at `/conf`) looks correct:
   `token.tms.mytms.{network: mynetwork, channel: settlement, namespace: tokenchaincode,
   driver: zkatdlog, wallets.owners: [pool_002_w1..w10 idemix, paths /var/fsc/keys/owner2/wallet/…/msp]}`
   and the key files (SignerConfig, IssuerPublicKey…) are inside the container.
   Source dive so far: `token/core/identity/msp/idemix/lm.go` (v0.3.0) —
   `NewIdemixWallet` passes conf identities into `idemix.NewLocalMembership(...)`; the
   x509 variant has an explicit `lm.Load(identities)` call, the idemix one receives them
   in the constructor. **Next: find why idemix registration doesn't run/produce entries**
   — check `NewLocalMembership` in `token/core/identity/msp/idemix/lm.go` (does it call
   registerIdentity at construction?), check the zkatdlog driver's wallet factory
   selection (`token/core/zkatdlog/…` — which role/wallet-type combos map to idemix),
   and check `fsc` `token.tms.*` parsing (`token/core/config`) for a nesting/`Enabled`
   flag mismatch. Also try `docker exec token-services-owner2 ls /var/fsc/keys/owner2/wallet`
   vs the conf path, and check whether owner1's old (working?) conf from git history
   differs structurally — e.g. `git log -p token-services/owner/conf/core.yaml.tpl`.
   NOTE: mint to bank 001 never succeeded in this session either (same class of error
   before the P2P fix), so this may never have worked end-to-end distributed — treat
   "it worked before on single host" as unverified.

E2E test itself (`bin/sworna test e2e`) additionally hardcodes `localhost` owner ports
and transfers to bank "003" — needs rework for the distributed topology
(`cli/sworna/test/e2e.py`, `cli/sworna/core/{config,api_client}.py`) or run manual curls:
mint via `POST /admin/mint`, balance via owner REST
`GET http://100.111.120.73:9300/api/v1/owner/accounts/{wallet}`, auditor history via
`GET http://100.72.112.29:9000/api/v1/auditor/accounts/{wallet}/transactions`.

### Phase 7 — Ingress: ⬜ NOT STARTED (plan §Phase 7 has the commands; CB host has internet).

## Pushed commits (main)

- `1b09f63` feat(scaling): auto-replenish wallet pool + tailscale dynamic discovery
- `5e1c951` fix(bank): map owner/peer hostnames to correct VM IPs in bank join
- `4be19b6` fix(fsc): patch sendTo … (pattern sed — **didn't match**, superseded)
- `3b68829` fix(fsc): line-addressed sed (build failed: unused `strings` import)
- `953c21b` fix(fsc): drop strings import — **current HEAD, builds OK, issuer rebuilt on CB**

## Uncommitted/untracked host state (not in git)

- CB: re-rendered `token-services/{issuer,auditor}/conf/core.yaml` (gitignored) with
  owner1/owner2 resolvers at their tailnet IPs; issuer conf `logging.spec: debug`
  (temporary); `token-services/docker-compose.net.yaml` regenerated;
  `token-services/.ca-client` re-enrolled; bank001 `wallet_pool` has 30 test "used"
  ids with **no Account rows behind them** (cosmetic; free them if you want 30 wallets
  back); `dist-bank-bundles/bank002.tar.gz` re-exported (fresh keys inside).
- bankpt: `token-services/owner/conf/owner2/core.yaml` logging = debug (temporary);
  owner2 image **not yet rebuilt** with the sendTo patch.

## Suggested next steps (priority order)

1. Solve the idemix wallet registration failure (Phase 6 blocker #4 above).
2. Rebuild auditor (CB) + owner2 (bankpt) images with the Dockerfile patch
   (`docker compose … up -d --build`), restart, re-test mint.
3. Script the CB-side issuer/auditor conf re-render into the onboarding flow.
4. Bank 1: needs human console access or tailnet ACL fix in the `clashroyale11288`
   account; after that `./scripts/bank-docker.sh up 001 …` style restart (keys already
   exist; its peer joined the channel previously).
5. Fix `bin/sworna test e2e` for distributed topology (bank 002, remote owner URLs).
6. Phase 7 ingress write-up.
