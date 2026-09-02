# ADR-0007: CouchDB as the peer state database

**Status:** Proposed — **not yet implemented** (as of Phase 3 the peers run LevelDB; `network/compose/docker/peercfg/core.yaml` sets `stateDatabase: goleveldb`)
**Date:** 2026-08-18
**Applies to:** all phases

## Context

Fabric peers support two state databases: **LevelDB** (simple key-value) and **CouchDB** (JSON documents with rich queries and indexes) [R3]. The Sworna system needs reporting, AML-style queries, and admin dashboards over ledger state, which favor rich JSON queries. The team chose CouchDB.

## Decision

Use **CouchDB** as the peer state database for all peers.

## Consequences

**Positive:** rich JSON queries and indexes for reporting/monitoring; better fit for the banking/admin console.
**Negative/risks:** higher memory footprint on the lab machines (8–16 GB); mitigated by capping container memory. LevelDB remains a documented fallback for very constrained hosts.

## References

- Fabric test network state-database option (`-s couchdb`): https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html [R3]
