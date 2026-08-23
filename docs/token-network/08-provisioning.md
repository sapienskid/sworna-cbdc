# Token network — provisioning & the banking lifecycle

How the real two-tier onboarding works: the **central bank is the trust anchor**;
banks are onboarded, given keys and permissions, and customers get accounts with
wallets from a per-bank pool.

## The trust model (recap)

- The **token CA** is the idemix issuer trusted by the chaincode params
  (`zkatdlog_pp.json`). It is controlled by the central bank.
- Wallets are only valid if issued by that CA — so **the CB can create keys for
  any bank**, and those keys work on the ledger.

## Wallet pools

Each bank's owner-node conf declares a fixed pool of wallets
(`pool_<code>_w1..w10`, e.g. `pool_001_w1` for bank 001), rendered on the bank's
VM from the conf template. The **key material** for those wallets does not exist
until the CB provisions the bank:

```
POST /api/v1/admin/banks/{code}/provision   (cb_admin only)
```

`app/provisioning.py` then, for each declared wallet with no key material:
1. `register`s the idemix identity at the token CA,
2. `enroll`s it into `keys/<owner_node>/wallet/<id>/msp`,
3. records the pool manifest (used/free) on the bank.

Provisioning is idempotent and can be re-run to top up.

## Lifecycle

```
CB creates bank (POST /banks)         -> status "registered"
CB generates keys (POST .../provision) -> wallet pool ready
CB activates bank (PATCH /banks/{code}/status) -> "active" (joined_at set)
Bank installs its join bundle on its VM
Bank staff onboard customers (POST /accounts) -> assign_wallet() takes the next
                                                 free pool wallet + account number
```

## Joining the network (per VM)

1. Each machine clones the repo and installs Fabric binaries/images.
2. The CB VM brings up the org1 network, deploys (approves) the chaincode and
   provisions banks.
3. Each bank **self-provisions its own Fabric org** on its own VM
   (`scripts/deploy-bank.sh <CODE>` → own CA + peer + org identity), then the CB
   adds it to the channel (`scripts/onboard-bank.sh`) and the bank joins + starts
   its owner service + portal. Its **token wallets** come from the CB's join
   bundle (`dist-bank-bundles/`).

## Permissions (enforced in the backend)

| Permission | Effect |
|---|---|
| `status` | registered → active → suspended; suspended banks' portals still read-only |
| `permissions.can_redeem` | blocks redeem (burn) if false |
| `permissions.interbank_limit_minor` | per-transfer cap on cross-bank sends (0 = unlimited) |
| `permissions.redeem_limit_minor` | per-redeem cap (0 = unlimited) |
| account `status` / `transfer_limit` | per-customer risk controls |

On-chain enforcement of these policies is Phase 4 (auditor-layer rules).

## Security notes

- Provisioning runs `fabric-ca-client` on the CB host; the CA admin credentials
  (`SWORNA_TOKEN_CA_ADMIN`) must be protected in real deployments.
- The join bundle contains the bank's idemix wallets — distribute over a
  trusted channel (Tailscale/SSH) in the lab.