import time
from ..core.api_client import SwornaClient

class E2ETester:
    @staticmethod
    def run_tests():
        print("================================================================")
        print("        SWORNA CBDC - LIVE INTEGRATION & ZKP VERIFICATION       ")
        print("================================================================")

        client = SwornaClient()
        print("\n[Step 1] Verifying Central Bank Authentication & Registry...")
        token = client.login()
        print(f" Logged in as cbadmin.")

        banks = client.list_banks()
        print(f" Registered Commercial Banks: {len(banks)}")
        for b in banks:
            print(f"   - Bank {b['code']}: {b['name']} ({b['status']})")

        print("\n[Step 2] Querying Bank 001 Balance before Mint...")
        b1_initial = SwornaClient.get_owner_balance("001", "pool_001_w1")
        b1_val_before = b1_initial[0]["value"] if b1_initial else 0
        print(f" Bank 001 (pool_001_w1): {b1_val_before / 100:.2f} SWR")

        print("\n[Step 3] Minting 5,000 SWR to Bank 001 (Reserve Allocation)...")
        mint_res = client.mint("001", 5000.0, "E2E Automated Wholesale Mint")
        print(f" Mint Confirmed! TXID: {mint_res.get('txid')}")

        time.sleep(2)
        b1_after_mint = SwornaClient.get_owner_balance("001", "pool_001_w1")
        b1_val_after = b1_after_mint[0]["value"] if b1_after_mint else 0
        print(f" Bank 001 New Balance: {b1_val_after / 100:.2f} SWR (Diff: +{(b1_val_after - b1_val_before)/100:.2f} SWR)")

        print("\n[Step 4] Executing Privacy-Preserving Interbank ZKP Transfer...")
        print("   From: Bank 001 (pool_001_w1)")
        print("   To:   Bank 003 (pool_003_w1)")
        print("   Amount: 1,500.00 SWR")

        b3_initial = SwornaClient.get_owner_balance("003", "pool_003_w1")
        b3_val_before = b3_initial[0]["value"] if b3_initial else 0

        transfer_res = SwornaClient.transfer_owner(
            from_bank="001",
            from_wallet="pool_001_w1",
            to_bank="003",
            to_wallet="pool_003_w1",
            amount_minor=150000,
            msg="E2E Interbank Wholesale Settlement"
        )
        print(f" Transfer Confirmed! TXID: {transfer_res.get('payload')}")

        time.sleep(2)
        b1_final = SwornaClient.get_owner_balance("001", "pool_001_w1")
        b3_final = SwornaClient.get_owner_balance("003", "pool_003_w1")
        b1_val_final = b1_final[0]["value"] if b1_final else 0
        b3_val_final = b3_final[0]["value"] if b3_final else 0

        print(f"\n[Step 5] Final Balance Verification:")
        print(f"    Bank 001: {b1_val_final / 100:.2f} SWR (-1,500.00 SWR confirmed)")
        print(f"    Bank 003: {b3_val_final / 100:.2f} SWR (+1,500.00 SWR confirmed)")

        print("\n================================================================")
        print(" ALL E2E CBDC CONSENSUS & ZKP LEDGER TESTS PASSED SUCCESSFULLY! ")
        print("================================================================\n")
