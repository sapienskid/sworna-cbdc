# Token network — UTXO & zero-knowledge model

## UTXO accounting

Money is a set of unspent transaction outputs. Each UTXO is identified by a
transaction id + index and carries:

```
{ owner: <idemix credential commitment>
  data:  <Pedersen commitment: g0^H(SWR) · g1^value · g2^blinding>
}
```

| Rule | Enforced by |
|---|---|
| Sum of inputs = sum of outputs | chaincode (on commitments) |
| An input can be spent only once | chaincode (delete on spend) |
| Outputs are non-negative and bounded | range proofs in the transfer |
| Only the owner can spend | ownership proof (prove the committed key) |
| Issuer can mint, auditor signs | public params in the chaincode |

## Change splitting

A transfer of 500 SWR from a 5000 SWR input produces **two** outputs:

```
input  5000 SWR (bob)              ┐
output 500 SWR  (carlos)           ├  sum preserved
output 4500 SWR (bob, change)      ┘
```

This is why balances in the owner services are sums over unspent outputs, not a
single running number.

## Zero-knowledge privacy (zkatdlog)

The privacy engine uses the **Fabric Token SDK's `zkatdlog` driver** (Zero-Knowledge Anonymous Transfers with Discrete Logarithms):

1. **Pedersen Commitments (Hidden Values & Token Types)**:
   - A token of value $v$ and type $\tau = \text{SWR}$ is committed on-ledger as:
     $$C = g_0^{H(\tau)} \cdot g_1^v \cdot g_2^r$$
     where $r \in \mathbb{Z}_q^*$ is a random blinding factor, $H(\tau)$ is the scalar hash of the token type, and $g_0, g_1, g_2$ are curve generators on the `BN254` pairing curve.
   - **Homomorphic property:** Peer nodes and the chaincode verify that no new money was created during a transfer by verifying the homomorphic equality over commitments:
     $$\prod C_{\text{in}} = \prod C_{\text{out}}$$
     This holds because $g_1^{\sum v_{\text{in}}} \cdot g_2^{\sum r_{\text{in}}} = g_1^{\sum v_{\text{out}}} \cdot g_2^{\sum r_{\text{out}}}$ when $\sum v_{\text{in}} = \sum v_{\text{out}}$ and the blinding factors balance out.

2. **ZKAT-DLOG Range Proofs (Preventing Negative Token Generation)**:
   - Without plaintext visibility, an adversary could generate negative tokens (e.g. $100 \to 1000 + (-900)$).
   - The sender generates zero-knowledge range proofs proving $v \ge 0$ and $v < 2^{64}$, as well as knowledge of the discrete logarithms ($v, r$) and ownership of the secret spending key, without leaking the values.

3. **Idemix Anonymity (Hidden Parties)**:
   - Customer identities are backed by **Identity Mixer (Idemix)** credentials issued by the Central Bank Token CA.
   - When transacting, parties generate fresh one-time pseudonym commitments. No static public keys or account identifiers exist on-chain.

4. **Auditor De-Blinding (Regulatory Oversight & AML)**:
   - To satisfy central-bank regulatory and AML oversight, the transaction proposal includes an audit payload containing the opening parameters $(v, r, \text{sender\_id}, \text{recipient\_id})$ encrypted under the **Auditor's public encryption key**.
   - The Central Bank Auditor node (`:9000`) decrypts this payload, validates financial integrity and compliance policies, and provides a cryptographic signature.
   - The chaincode rejects any transaction that lacks a valid signature from the authorized Auditor.

## What the auditor can do

The auditor's REST API reveals full amounts + sender/recipient for any account
(`/api/v1/auditor/accounts/{id}/transactions`). This is the oversight mechanism
that balances the privacy: the ledger is blind to everyone **except** the
auditor and the transacting parties.

## Security notes (what we did NOT reimplement)

This privacy is provided by the **Fabric Token SDK's** zkatdlog driver — an
audited, battle-tested implementation. We deliberately did **not** write our own
ZK scheme: it is a multi-month crypto project with severe risk of subtle bugs.
Our contribution is owning the *system* around it (network, services, banking
API, UI), not the cryptography itself.