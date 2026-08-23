#!/usr/bin/env bash
#
# Bank B (code 002) — thin wrapper for ./scripts/deploy-bank.sh
exec "$(dirname "${BASH_SOURCE[0]}")/deploy-bank.sh" 002