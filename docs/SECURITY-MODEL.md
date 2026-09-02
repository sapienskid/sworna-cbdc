# Security Model — trust, cryptography, authentication, and known limits

What protects what, why each choice was made, and where the honest boundaries
of this prototype are. Companion to
[BLIND-SIGNATURES-AND-PRIVACY.md](BLIND-SIGNATURES-AND-PRIVACY.md) (the ZK
layer in depth) and [BACKEND-INTERNALS.md](BACKEND-INTERNALS.md).

---

## 1. Trust anchors

| Anchor | Holder | Why trusted |
|---|---|---|
| **Token chaincode public params** (`zkatdlog_pp.json`) | Baked into the chaincode image at setup | Defines the Pedersen generators, issuer public keys, Idemix issuer PK and auditor key. All proof verification keys derive from it; changing it invalidates every token |
| **Token CA (= Idemix issuer)** | Central bank host (`:27054`) | Mints every wallet credential and every owner-node identity. Whoever controls it can mint valid wallets — hence it never leaves the CB |
| **Fabric CAs + MSPs** | One per org; banks run their own | Org identities for peers/orderers. Banks self-provision, so bank keys never leave the bank VM |
| **Auditor key** | Central bank | Decrypts the per-transaction audit opening; co-signs every transaction |
| **Central bank ledger** | CB backend registry | Off-chain identity (names, KYC, account numbers). Banks own their customers' data; the CB sees AML alerts and statements through the auditor |

## 2. Cryptography in use

| Purpose | Primitive | Library |
|---|---|---|
| Wallet credentials / unlinkable pseudonyms | CL blind signatures over BN254 | IBM Idemix via Fabric CA (`--enrollment.type idemix`) |
| Amount hiding | Pedersen commitments | Token SDK `zkatdlog` driver |
| No negative money | ZK range proofs (base 300, exp 5) | Token SDK `zkatdlog` |
| Transaction integrity | ECDSA x509 endorsements (issuer, owners, auditor) + Fabric channel policy | Hyperledger Fabric v3.1 |
| Ordering | BFT consensus (4 consenters) | SmartBFT |
| Password storage | PBKDF2-HMAC-SHA256, 120 000 iterations, per-user salt | stdlib (`backend/app/security.py`) |
| Session tokens | JWT HS256, 12 h expiry, `SWORNA_JWT_SECRET` | PyJWT |

## 3. Application security controls

- **AuthN**: all `/api/v1` endpoints require a Bearer JWT; 401 on missing/
  expired. Passwords are never stored in the clear; `cbadmin`'s bootstrap
  password comes from `SWORNA_CB_ADMIN_PASSWORD`.
- **AuthZ**: role ladder in `backend/app/deps.py`. Bank users are scoped to
  their own bank (registry *and* payment paths); customers to their own
  account. CB roles are separated into admin / mint officer / auditor with
  distinct dependencies per endpoint group.
- **Payment gates** (defense in depth, in order): bank status → account
  status → AML limits → bank permissions → watchlist → (ledger: auditor
  co-signature + double-spend prevention). See
  [BACKEND-INTERNALS.md](BACKEND-INTERNALS.md) §5.
- **Provisioning is idempotent** and only ever *adds* missing identities; keys
  are generated on the host that owns them (bank keys on bank VMs).
- **CORS** is configurable (`SWORNA_CORS_ORIGINS`, comma-separated; default
  `*` for dev — set it to the portal origins in any shared deployment).

## 4. What the ledger guarantees (and what it doesn't)

Guaranteed by Fabric + the token chaincode:

- No double spend (UTXO consumption is validated atomically).
- No forged amounts (commitments + range proofs + issuer/auditor signatures).
- No transaction without CB auditor approval.
- Tamper-evident history (hash-chained blocks, BFT ordering).

Not guaranteed by the ledger:

- *Regulatory policy* — the chaincode cannot refuse a transfer because a
  customer is flagged; that is the off-chain AML engine's job (ADR-0011).
  The auditor gate is the ledger-side backstop: nothing commits unseen.
- *Identity of humans* — the ledger knows pseudonyms; the mapping to
  account numbers lives in the (compartmentalized) registries.

## 5. Honest limitations of this prototype

1. **Engine REST is unauthenticated.** The Go issuer/owner/auditor services
   come from the Token SDK sample and have no authn on their REST APIs;
   anyone who can *reach* an owner service could drive it. Mitigation:
   deployment topology (dedicated VMs on Tailscale, services not exposed
   publicly). Before any shared deployment: put mTLS or a network policy in
   front of `:9100/:9200+/:9000` and restrict egress to the backend.
2. **Demo credentials exist** (`sworna-cb`, `sworna-bank`, `sworna-pass`)
   because the system is seeded for repeatable demos; override
   `SWORNA_CB_ADMIN_PASSWORD` and onboard staff with real passwords for any
   non-demo use. There is no rate limiting/lockout on `/auth/login` yet.
3. **Watchlist matching is a substring demo**, not a production sanctions
   scanner (no fuzzy matching, no list ingestion, no audit dossier).
4. **JWTs are in `localStorage`** — acceptable for the lab, but XSS-exposed;
   a production build would use HttpOnly cookies and refresh tokens.
5. **`transaction_log` is optimistic** (`status="Confirmed"` written at
   submit time); a post-submit finality failure needs operator
   reconciliation.
6. **Single SQLite registry** per host — fine for a prototype, replace with
   Postgres for scale; the pool/account-number row locks matter once you do.
7. **Key backup/rotation is undocumented and untested** (token CA, auditor
   key). Losing the token CA means no new wallets; regenerating public
   params invalidates all tokens.

## 6. Hardening checklist before any shared/persistent deployment

- [ ] Set `SWORNA_JWT_SECRET` (long random), `SWORNA_CB_ADMIN_PASSWORD`,
      `SWORNA_CORS_ORIGINS` on every host.
- [ ] Network-isolate the engine ports (`:9000/:9100/:9200+`) to the backend
      host; add mTLS or auth proxy.
- [ ] Put HTTPS in front of the backend (Caddy/Traefik/nginx).
- [ ] Back up `token-services/keys/` (encrypted) and test restore.
- [ ] Add login rate limiting and rotate staff credentials out of demo
      defaults.
- [ ] Enable Fabric TLS everywhere it isn't already, and review channel ACLs
      for non-member read access.
