# Token network — chaincode parameters (tokengen)

The token chaincode's validity rules are fixed by **public parameters** baked
into the chaincode image at build time. They are generated once with `tokengen`.

## What the parameters contain

```
tokenchaincode/zkatdlog_pp.json
```

- Driver `zkatdlog`, version 1
- Curve: BLS12-381 (production) / BN254 (dev)
- Pedersen generators g0, g1, g2 (token type / value / blinding)
- Range-proof parameters (base 300, exponent 5)
- **Issuer public keys** (x.509 certs of the CB issuer)
- **Auditor public keys** (x.509 certs of the CB auditor)
- **Idemix issuer public key** (the token CA that issues owner credentials)

## How it is generated (for our network)

The params are **already generated and committed** at `tokenchaincode/zkatdlog_pp.json`
— no regeneration is needed at deploy time. For reference, the command that
produced them (using a demo owner wallet to pin the token CA's public key):

```bash
tokengen gen dlog \
  --base 300 --exponent 5 \
  --issuers  keys/issuer/iss/msp \
  --idemix   keys/owner1/wallet/alice \
  --auditors keys/auditor/aud/msp \
  --output   tokenchaincode
```

- `--issuers` / `--auditors`: MSP folders containing the **x.509** identities of
  the issuer and auditor. These are the same public keys the chaincode checks
  against when validating signatures.
- `--idemix`: an idemix wallet whose issuing CA's public key the chaincode will
  trust for owner credentials.

> The idemix CA here is the shared **token CA** (a documented simplification).
> The plan's "each bank runs its own idemix CA" is a Phase-4 hardening step.

## SWR token definition

The chaincode is token-type agnostic: a token type is just a string code. SWR's
definition lives at the banking layer:

| Property | Value |
|---|---|
| Code | `SWR` |
| Symbol | रू |
| Decimals | 2 (off-chain) |
| On-chain representation | integer minor units (`10000` = `100.00` SWR) |
| Max token per UTXO | bounded by range-proof parameters |

## Regenerating (and invalidating)

If you regenerate parameters, all previously issued tokens become **invalid**
(their old proofs won't verify against the new parameters). Regeneration is a
"reset the network" operation — see the bring-up docs.