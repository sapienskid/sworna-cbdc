import sys
import argparse
from .roles.central_bank import CentralBankManager
from .roles.bank import BankManager
from .test.e2e import E2ETester

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sworna",
        description="Sworna CBDC Unified Deployment & Management CLI"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Central Bank commands
    cb_parser = subparsers.add_parser("cb", help="Central Bank Stack operations")
    cb_sub = cb_parser.add_subparsers(dest="subcommand", help="Central Bank actions")
    
    cb_init = cb_sub.add_parser("init", help="Initialize and start Central Bank network and services")
    cb_init.add_argument("--provision", action="store_true", default=True, help="Mint initial wallet pools")

    cb_mint = cb_sub.add_parser("mint", help="Mint CBDC tokens to a bank")
    cb_mint.add_argument("--bank", required=True, help="Target bank code (e.g. 001)")
    cb_mint.add_argument("--amount", type=float, required=True, help="Amount in SWR")
    cb_mint.add_argument("--reference", default="Wholesale Mint", help="Transaction reference")

    cb_sub.add_parser("status", help="Check Central Bank containers and health")
    cb_sub.add_parser("down", help="Stop Central Bank containers and network")

    # Commercial Bank commands
    bank_parser = subparsers.add_parser("bank", help="Commercial Bank operations")
    bank_sub = bank_parser.add_subparsers(dest="subcommand", help="Bank actions")

    bank_init = bank_sub.add_parser("init", help="Initialize Bank MSP identity and peer")
    bank_init.add_argument("--code", required=True, help="Bank code (e.g. 001)")
    bank_init.add_argument("--cb-host", default="127.0.0.1", help="Central Bank host IP")

    bank_start = bank_sub.add_parser("start", help="Join channel and start Bank FSC services")
    bank_start.add_argument("--code", required=True, help="Bank code (e.g. 001)")
    bank_start.add_argument("--cb-host", default="127.0.0.1", help="Central Bank host IP")

    bank_status = bank_sub.add_parser("status", help="Check Bank container status")
    bank_status.add_argument("--code", required=True, help="Bank code (e.g. 001)")

    bank_down = bank_sub.add_parser("down", help="Stop Bank containers")
    bank_down.add_argument("--code", required=True, help="Bank code (e.g. 001)")

    # Test commands
    test_parser = subparsers.add_parser("test", help="Testing & verification")
    test_sub = test_parser.add_subparsers(dest="subcommand", help="Test actions")
    test_sub.add_parser("e2e", help="Run end-to-end integration and ZKP transfer test")

    return parser

def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    try:
        if args.command == "cb":
            if args.subcommand == "init":
                CentralBankManager.init(provision=args.provision)
            elif args.subcommand == "mint":
                CentralBankManager.mint(bank_code=args.bank, amount=args.amount, reference=args.reference)
            elif args.subcommand == "status":
                CentralBankManager.status()
            elif args.subcommand == "down":
                CentralBankManager.down()
            else:
                parser.parse_args(["cb", "--help"])

        elif args.command == "bank":
            if args.subcommand == "init":
                BankManager.init(code=args.code, cb_host=args.cb_host)
            elif args.subcommand == "start":
                BankManager.start(code=args.code, cb_host=args.cb_host)
            elif args.subcommand == "status":
                BankManager.status(code=args.code)
            elif args.subcommand == "down":
                BankManager.down(code=args.code)
            else:
                parser.parse_args(["bank", "--help"])

        elif args.command == "test":
            if args.subcommand == "e2e":
                E2ETester.run_tests()
            else:
                parser.parse_args(["test", "--help"])
    except KeyboardInterrupt:
        print("\nAborted.")
        sys.exit(130)
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
