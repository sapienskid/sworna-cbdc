# Blind Signatures & Privacy — how Sworna hides who pays whom, and how much

This is the step-by-step explanation of the privacy layer: what a blind
signature is, where it is used in Sworna, how transaction amounts are hidden,
and how the central bank can still see everything for compliance. It covers
both *what technology is used* and *why*.

> **Where the code lives.** Sworna does **not** implement these cryptographic
> primitives by hand. The math comes from two battle-tested libraries:
> **IBM Idemix** (the blind-signature credential system, `github.com/IBM/idemix`)
> and the **Hyperledger Fabric Token SDK** with the `zkatdlog` driver
> (Pedersen commitments + zero-knowledge range proofs). Sworna's own code
> (`token-services/`, `backend/`) orchestrates issuance, transfers, audit and
> policy around them. The split of responsibilities is recorded in ADR-0001,
> ADR-0006 and ADR-0010.

---

## 1. The problem: digital cash that behaves like banknotes

Physical cash is private: the shop does not learn your name, and the bank does
not learn what you bought. A naive digital token fails at this because a
database entry or a plain UTXO records *who owns what*. Sworna needs three
properties at once:

| Property | Meaning | Provided by |
|---|---|---|
| **Unlinkability** | Nobody can connect two payments made by the same wallet | Idemix pseudonyms (blind signatures) |
| **Amount privacy** | The ledger never shows amounts | Pedersen commitments + ZK range proofs (`zkatdlog`) |
| **Non-forgery / no double spend** | Only a legitimate wallet can spend, and only once | CL signature proofs + chaincode UTXO checks |

And one property that conflicts with all three: **regulatory visibility**. The
central bank must be able to de-anonymize any transaction. Sworna resolves
this with an *auditor gate*: no transaction commits without the auditor's
signature, and every transaction carries an encrypted opening only the
auditor can decrypt.

## 2. Blind signatures, step by step

A **blind signature** is a signature on a message the signer never sees.
The classic analogy: the signer signs the outside of a sealed envelope; the
recipient later opens the envelope and the signature transfers to the document
inside.

Sworna uses the **Camenisch–Lysyanskaya (CL) signature scheme** as implemented
by Idemix, over the BN254 pairing curve. A CL signature signs a vector of
attributes `(m1, ..., mL)` — for a wallet credential these are the user's
secret key, and randomness chosen by the user.

### 2.1 Issuing a wallet credential (at provisioning)

This happens once, when a wallet is minted for a bank or customer:

1. **Key generation (once per network).** The token CA generates a CL
   issuer keypair `(pk, sk)`. The public key is published in the token
   chaincode's public parameters (`zkatdlog_pp.json`, field
   `IdemixIssuerPK`), so every peer can verify credentials against it.
   See `docs/token-network/04-chaincode-params.md`.
2. **Blinding (wallet side).** The wallet generates a secret `sk_user` and a
   random blinding nonce, and constructs a *credential request* in which every
   attribute is hidden: it sends commitments `C_i = g^{m_i} · h^{r_i}`
   instead of the values `m_i`. Because of the blinding nonce, the CA cannot
   derive `sk_user` from the request.
3. **Signing (token CA side).** The CA signs the *committed* attributes with
   its issuer secret key. This is the "signing the sealed envelope" step —
   the CA proves the wallet is registered without ever learning its secret.
   In Sworna this is done by `fabric-ca-client` with
   `--enrollment.type idemix --idemix.curve gurvy.Bn254`
   (`backend/app/provisioning.py:108-124`); the CA runs on the CB host
   (`:27054`) because the trust model makes the token CA the Idemix issuer
   (see `docs/token-network/08-provisioning.md`).
4. **Unblinding (wallet side).** The wallet strips the blinding nonce and now
   holds a valid CL signature `(A, e, s)` over its attributes — a credential
   only it possesses, which the CA never saw in the clear.

The wallet stores the credential as its `SignerConfig`
(`token-services/keys/<node>/wallet/<wid>/msp/user/SignerConfig`). The CB
portal's *Privacy & Cryptography* page lists a SHA-256 fingerprint of each
wallet's credential for inventory (`GET /admin/crypto/wallets`) — the key
material itself never leaves the bank's VM.

### 2.2 Spending with unlinkable pseudonyms (every transaction)

Holding a credential does not mean showing it. If the wallet presented the
credential itself, every payment would be linkable. Instead, at each spend
the Idemix wallet derives a **fresh one-time pseudonym (nym)** and proves, in
zero knowledge:

- "I own a valid CL signature issued by the known token CA" — without
  revealing the signature `(A, e, s)`;
- "the pseudonym is derived from that same credential" — without revealing
  which one;
- "I authorize this exact transaction" — the proof is bound to the
  transaction hash.

Because the nym is fresh per transaction, two payments from the same wallet
share nothing observable. This is the unlinkability property. In the token
flows this happens inside `ttx.RequestRecipientIdentity` /
`ttx.NewCollectEndorsementsView` (`token-services/issuer/service/issue.go`,
`token-services/owner/service/transfer.go`); recipient identities are always
fresh nyms, never the wallet's main key
(`token-services/owner/service/accept.go:25-35`).

## 3. Hiding amounts: Pedersen commitments and range proofs

Amounts are protected by the `zkatdlog` driver of the Token SDK
(ADR-0006). Every token UTXO on the ledger is a record of commitment
*outputs*, not plaintext values:

```
C = g0^H(SWR) · g1^v · g2^r
```

- `v` — the value in minor units (hidden),
- `r` — a random blinding factor (hidden),
- `H(SWR)` — the token type hashed into the generator, so SWR commitments
  cannot be mixed with another currency's.

**Verification without learning.** A transaction consumes input tokens and
produces output tokens with change splitting (1000 SWR in → 100 to recipient
+ 900 change). The chaincode checks the homomorphic relation
`∏ C_in = ∏ C_out`, which holds if and only if the sums match — no value is
revealed. **Range proofs** (zero-knowledge, base 300, exponent 5 in the
current parameters) additionally prove each hidden `v ≥ 0`, so nobody can
mint money by producing a negative output.

The exact parameters — generators, range-proof base/exponent, issuer keys,
auditor key — are baked into `token-services/tokenchaincode/zkatdlog_pp.json`
at chaincode setup. The CB portal's *Privacy & Cryptography* page surfaces
their live fingerprints via `GET /admin/crypto/params`.
**Regenerating the parameters invalidates every token in circulation.**

## 4. The auditor gate: privacy with a pressure valve

Every token transaction — issue, transfer, redeem — is constructed as a
`ttx.Transaction` with `ttx.WithAuditor(auditor)`:

1. The sender encrypts the *opening* of every commitment
   `(v, r, sender_id, recipient_id)` under the **auditor's public key**
   (an x509 identity pinned in the chaincode parameters).
2. The auditor node (`:9000` on the CB host) receives the transaction via its
   FSC view (`token-services/auditor/service/audit.go:25-60`), runs
   `auditor.Validate(tx)` (cryptographic validity + proof checks), can
   decrypt the opening to see exactly who paid whom how much, and co-signs it
   (`ttx.NewAuditApproveView`).
3. The chaincode requires the auditor's endorsement — **without it the
   transaction can never be committed**. This is the strongest control in the
   stack: even a compromised bank node cannot move funds outside the CB's
   sight.

What the auditor *cannot* do is forge — it sees and approves, but the
issuer/owner signatures still gate minting and spending.

## 5. What is hidden from whom — summary matrix

| Observer | Sees amounts | Sees parties | Can link two payments of same wallet |
|---|---|---|---|
| Fabric peer / orderer | No (commitments) | No (pseudonyms) | No |
| Sending/receiving wallet | Own txns only | Own counterparties | Knows own activity only |
| Network observer (libp2p/HTTP) | No | No | No |
| **CB auditor node** | **Yes** (de-blinding key) | **Yes** | **Yes** |
| CB backend registry | Off-chain mirrors + statements via auditor API | Yes (account numbers) | Yes |

The retail customer's *off-chain* identity (account number, name, KYC) lives
in the bank's registry only — it is never written to the ledger.

## 6. Verify it yourself

1. **Params:** `GET /api/v1/admin/crypto/params` (CB login) — fingerprints of
   the live Pedersen generators, Idemix issuer PK and auditor cert; matches
   `token-services/tokenchaincode/zkatdlog_pp.json`.
2. **Ledger is opaque:** decode a committed block with
   `peer channel fetch` + `configtxlator` (the CB portal does this for
   `GET /admin/ledger`) and search the block JSON for the transferred amount —
   you will find commitments and proofs, no plaintext `1000.00`.
3. **Pseudonyms:** `GET /accounts/{n}/statements` (served through the auditor
   API) shows wallet ids in the `sender`/`recipient` fields that differ per
   transaction — those are one-time nyms, translated to account numbers by the
   backend where a mapping exists.

## References

- Idemix / CL signatures: `docs/REFERENCES.md` R13 (Token SDK docs), IBM
  Idemix specification.
- `zkatdlog` model: `docs/token-network/03-utxo-zk-model.md`,
  `docs/token-network/04-chaincode-params.md`.
- Trust model (token CA = Idemix issuer): `docs/token-network/08-provisioning.md`.
- ADR-0006 (UTXO + ZK), ADR-0004 (CB is issuer and auditor), ADR-0010 (own token layer).
