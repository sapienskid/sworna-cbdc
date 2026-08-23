# network/ — the Sworna settlement network

Our Hyperledger Fabric network (adapted from the fabric-samples test network and
now owned here). The **central-bank org** runs here on the CB host; each
commercial bank **self-provisions its own org + peer on its own VM** and is added
to the channel via `scripts/onboard-bank.sh`.

| Org | MSP | Domain | Peer | Host |
|---|---|---|---|---|
| Central bank | `CentralBankMSP` | `centralbank.sworna.example.com` | `peer0.centralbank.sworna.example.com:7051` | CB |
| Bank `k` | `Bank{k}MSP` | `bank{k}.sworna.example.com` | `peer0.bank{k}.sworna.example.com:9051+2000(k−1)` | bank k |

Channel: `settlement`. Orderer: `orderer.sworna.example.com:7050` (single-node
Raft in dev; more orderers in the lab/Phase 4).

## Bring-up

```bash
# CB host (org1 only):
./network.sh up createChannel -ca          # orderer + peer0.centralbank + channel settlement
./network.sh deployCCAAS -ccn tokenchaincode -ccp ../token-services/tokenchaincode -ccs 1
./network.sh down                          # teardown

# Banks use scripts/bank-network.sh + scripts/onboard-bank.sh (see ../docs/SETUP.md)
```

Prerequisites: the Fabric binaries/images installed into `bin/`/`config/` at
the repo root (see the root README, or `./scripts/install-fabric-tools.sh`).

## Layout

- `configtx/` — organizations, MSPs, channel, Raft profile (`configtx.bank.yaml.tpl`
  is rendered on bank VMs to print their org MSP JSON).
- `organizations/` — Fabric CA registration/enrollment scripts; generated crypto
  is gitignored (`registerEnroll-bank.sh` runs on each bank VM against its own CA).
- `compose/` — docker compose for CAs, orderers, peers; `compose-bank-peer.yaml`
  is the parameterized per-bank CA + peer.
- `scripts/` — channel creation, CCAAS deployment, config-update helpers.
- `addOrg3/` — **DEPRECATED.** The old "bank joins on the CB host" flow. Banks
  now self-provision on their own VMs; use `scripts/onboard-bank.sh` instead.

## Notes

- `bft-config/` and the `-bft`/couch/podman/deployCC paths are retained from the
  upstream network for future phases (SmartBFT, CouchDB); we currently run
  single Raft orderer + LevelDB + chaincode-as-a-service.
- Docs: [docs/DEMO.md](../docs/DEMO.md) · [docs/token-network](../docs/token-network).