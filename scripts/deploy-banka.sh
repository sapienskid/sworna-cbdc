#!/usr/bin/env bash
#
# Bank A (code 001) — thin wrapper for ./scripts/deploy-bank.sh
exec "$(dirname "${BASH_SOURCE[0]}")/deploy-bank.sh" 001