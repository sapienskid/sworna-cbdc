#!/usr/bin/env bash
#
# Shared "bank host registry" helpers — source this file, don't execute it.
#
# The registry is a small env file (network/bank-hosts.env) that records the
# owner->host-IP mapping so no script (or human) ever has to spell out
# SWORNA_OWNERS / SWORNA_OWNER_<NAME>_HOST again. add-bank.sh keeps it up to
# date; every deploy script sources it as a FALLBACK — an explicitly exported
# environment variable always wins.
#
#   load_bank_hosts        # source the file if present (non-destructive)
#   bank_hosts_upsert SWORNA_OWNER_OWNER3_HOST 10.1.2.3
#   bank_hosts_set_owners "owner1 owner2 owner3"

bank_hosts_file() {
  if [ -n "${SWORNA_HOSTS_FILE:-}" ]; then
    printf '%s' "$SWORNA_HOSTS_FILE"
  else
    local root
    root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
    printf '%s' "$root/network/bank-hosts.env"
  fi
}

load_bank_hosts() {
  local f
  f="$(bank_hosts_file)"
  [ -f "$f" ] || return 0
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs 2>/dev/null || echo "$line")"
    [ -n "$line" ] || continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    [ -n "$key" ] || continue
    # never override an explicitly exported variable
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done < "$f"
}

bank_hosts_upsert() {
  local key="$1" value="$2" f
  f="$(bank_hosts_file)"
  touch "$f"
  if grep -qE "^${key}=" "$f" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$f"
  else
    printf '%s=%s\n' "$key" "$value" >> "$f"
  fi
}

bank_hosts_set_owners() {
  bank_hosts_upsert SWORNA_OWNERS "$1"
}
