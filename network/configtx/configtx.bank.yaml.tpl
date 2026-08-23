# Minimal configtx for a commercial bank, used only to print the bank's org
# MSP JSON (configtxgen -printOrg) on the bank's OWN VM. Rendered by
# scripts/bank-network.sh from @@BANK_MSP@@ @@BANK_ORG@@ @@PEER_PORT@@.
Organizations:
  - &BankOrg
    Name: @@BANK_MSP@@
    ID: @@BANK_MSP@@
    MSPDir: ../organizations/peerOrganizations/@@BANK_ORG@@.sworna.example.com/msp
    Policies:
      Readers:
        Type: Signature
        Rule: "OR('@@BANK_MSP@@.admin', '@@BANK_MSP@@.peer', '@@BANK_MSP@@.client')"
      Writers:
        Type: Signature
        Rule: "OR('@@BANK_MSP@@.admin', '@@BANK_MSP@@.client')"
      Admins:
        Type: Signature
        Rule: "OR('@@BANK_MSP@@.admin')"
      Endorsement:
        Type: Signature
        Rule: "OR('@@BANK_MSP@@.peer')"
    AnchorPeers:
      - Host: peer0.@@BANK_ORG@@.sworna.example.com
        Port: @@PEER_PORT@@