#!/usr/bin/env bash
#
# ONE-STEP bank onboarding — run ON THE CENTRAL-BANK HOST:
#
#   ./scripts/add-bank.sh 003                 # bank on the CB VM itself (all-in-one demo)
#   ./scripts/add-bank.sh 003 10.1.2.3        # bank on its own VM (driven over SSH)
#
# Everything else is automated:
#   1. register the bank in the CB registry (+ staff login) and provision its
#      token-CA identities (owner FSC identity + Idemix pool wallets)
#   2. export its join bundle (wallets + orderer certs)
#   3. sync the repo to the bank VM (remote mode) and unpack the bundle
#   4. run the bank's identity phase remotely (own CA + peer + org enrollment)
#      and pull back its public org MSP JSON
#   5. record host IPs in network/bank-hosts.env and fix cross-host DNS
#      (best-effort /etc/hosts on the CB host)
#   6. admit the org to the `settlement` channel (live, collects co-signatures)
#   7. bank VM: join the channel, start owner engine + backend + portal
#   8. commit/upgrade the chaincode endorsement policy and verify
#
# Every step is idempotent — re-running resumes where it stopped.
#
# Options:
#   --name NAME      display name          (default: banka/bankb/... for 001..026)
#   --pool N         wallet pool size      (default 10)
#   --cb-host IP     IP other VMs use to reach THIS host (default: auto-detect)
#   --user U         SSH user on the bank VM   (default: current user / SWORNA_BANK_USER)
#   --repo-dir DIR   repo path on the bank VM  (default ~/sworna-cbdc / SWORNA_REPO_DIR)
#   --no-sync        don't rsync the repo (bank VM already has an up-to-date clone)
#   --skip-portal    don't start the bank's dev portal
#   --skip-commit    don't run commit-chaincode.sh (rarely needed; done by default)
#   --dry-run        print the plan without executing
#
# Env: SWORNA_CB_HOST (= --cb-host), SWORNA_BANK_USER, SWORNA_REPO_DIR,
#      SWORNA_BACKEND, SWORNA_CB_ADMIN_PASSWORD. Host IPs of existing banks are
#      read from network/bank-hosts.env (kept current by this script); explicit
#      environment variables always win over that file.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="$ROOT/bin:$PATH"
. "$ROOT/scripts/bank-hosts.sh"
load_bank_hosts

# ---------------------------------------------------------------- arguments --
BANK_CODE="" ; BANK_HOST="" ; BANK_NAME="" ; POOL_SIZE="${POOL_SIZE:-10}"
CB_HOST="${SWORNA_CB_HOST:-}" ; SSH_USER="${SWORNA_BANK_USER:-$USER}"
REPO_DIR="${SWORNA_REPO_DIR:-\$HOME/sworna-cbdc}"   # expanded by the remote shell
DO_SYNC=1 ; START_PORTAL=1 ; DO_COMMIT=1 ; DRY=0

usage() { sed -n '3,42p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --name) BANK_NAME="$2"; shift 2 ;;
    --pool) POOL_SIZE="$2"; shift 2 ;;
    --cb-host) CB_HOST="$2"; shift 2 ;;
    --user) SSH_USER="$2"; shift 2 ;;
    --repo-dir) REPO_DIR="$2"; shift 2 ;;
    --no-sync) DO_SYNC=0; shift ;;
    --skip-portal) START_PORTAL=0; shift ;;
    --skip-commit) DO_COMMIT=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) if [ -z "$BANK_CODE" ]; then BANK_CODE="$1";
       elif [ -z "$BANK_HOST" ]; then BANK_HOST="$1";
       else echo "too many positional args" >&2; usage; fi; shift ;;
  esac
done
[ -n "$BANK_CODE" ] || usage
[[ "$BANK_CODE" =~ ^[0-9]{3}$ ]] || { echo "bank code must be 3 digits (001..999)" >&2; exit 1; }

k=$((10#$BANK_CODE))
OWNER_NODE="owner${k}"; BANK_ORG="bank${k}"; BANK_MSP="Bank${k}MSP"
OWNER_PORT=$((9200 + 100 * (k - 1)))
if [ -z "$BANK_NAME" ]; then
  if [ "$k" -le 26 ]; then
    BANK_NAME="bank$(printf "\\$(printf '%03o' $((96 + k)))")"
  else
    BANK_NAME="bank${k}"
  fi
fi
STAFF_USER="bank${k}_admin"
REMOTE=0; [ -n "$BANK_HOST" ] && REMOTE=1

log()  { printf '\033[1;32m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"

ssh_run() { ssh $SSH_OPTS "${SSH_USER}@${BANK_HOST}" "$@"; }
scp_to()  { scp $SSH_OPTS "$@"; }
scp_from(){ scp $SSH_OPTS "$@"; }

# All SWORNA_OWNER_*_HOST vars currently defined in this shell, as an env
# string safe to paste into a remote `env ...` command.
owner_host_env() {
  local out="" v
  for v in ${!SWORNA_OWNER_@}; do out="$out $v=${!v}"; done
  printf '%s' "$out"
}

# ------------------------------------------------------------ preflight -----
log "Bank $BANK_CODE ($BANK_NAME) → ${BANK_HOST:-this VM}  [$BANK_MSP / $OWNER_NODE]"

BACKEND="${SWORNA_BACKEND:-http://localhost:8000/api/v1}"
command -v jq >/dev/null || die "jq is required on the CB host"
command -v docker >/dev/null || die "docker is required on the CB host"
if [ "$DRY" != "1" ]; then
  curl -sf http://localhost:8000/healthz >/dev/null 2>&1 \
    || die "backend not reachable on :8000 — deploy the central bank first (deploy-centralbank.sh)"
fi

if [ "$REMOTE" = "1" ]; then
  if [ -z "$CB_HOST" ]; then
    CB_HOST=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}')
  fi
  [ -n "$CB_HOST" ] || die "could not auto-detect this host's IP — pass --cb-host"
  [ "$DRY" = "1" ] || ssh $SSH_OPTS -o BatchMode=yes "${SSH_USER}@${BANK_HOST}" true 2>/dev/null \
    || die "cannot SSH to ${SSH_USER}@${BANK_HOST} — set up key-based access (ssh-copy-id $BANK_HOST) or pass --user"
  log "preflight OK (remote mode: bank VM $BANK_HOST, this host seen as $CB_HOST)"
else
  CB_HOST="${CB_HOST:-127.0.0.1}"
  log "preflight OK (all-in-one mode: the bank runs on this VM)"
fi

# ------------------------------------------------- 1. register + provision --
log "[1/8] registering bank + minting token-CA identities"
ADMIN_USER="${SWORNA_CB_ADMIN_USER:-cbadmin}"
ADMIN_PASS="${SWORNA_CB_ADMIN_PASSWORD:-sworna-cb}"
TOKEN=""
if [ "$DRY" = "1" ]; then
  echo "[dry-run] POST /banks + POST /admin/banks/$BANK_CODE/provision"
  OWNERS="${SWORNA_OWNERS:-}"
else
  TOKEN=$(curl -sf -X POST "$BACKEND/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | jq -er .token) \
    || die "CB admin login failed"
  REGISTER_BODY=$(jq -n --arg code "$BANK_CODE" --arg name "$BANK_NAME" --arg msp "$BANK_MSP" \
    --arg owner "$OWNER_NODE" --arg staff "$STAFF_USER" --arg pool "$POOL_SIZE" \
    --arg portal "http://${BANK_HOST:-127.0.0.1}:5173" \
    '{code:$code, name:$name, msp_id:$msp, owner_node:$owner, staff_username:$staff,
      pool_size:($pool|tonumber), portal_url:$portal}')
  CODE=$(curl -s -o /tmp/add-bank-resp.json -w '%{http_code}' -X POST "$BACKEND/banks" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$REGISTER_BODY")
  case "$CODE" in
    201) echo "    registered in the CB registry" ;;
    409) echo "    already registered — reusing" ;;
    *) die "bank registration failed (HTTP $CODE): $(cat /tmp/add-bank-resp.json)" ;;
  esac
  PROV=$(curl -sf -X POST "$BACKEND/admin/banks/$BANK_CODE/provision" -H "Authorization: Bearer $TOKEN") \
    || die "provisioning failed — check the token CA (port 27054)"
  echo "    wallets: $(echo "$PROV" | jq -r .used) used, $(echo "$PROV" | jq -r .free) free"
  # full owner list = every registered bank's owner + this one
  OWNERS=$(curl -sf "$BACKEND/banks" -H "Authorization: Bearer $TOKEN" | jq -r '[.[].owner_node] | join(" ")')
  case " $OWNERS " in *" $OWNER_NODE "*) ;; *) OWNERS="$OWNERS $OWNER_NODE" ;; esac
fi
case " $OWNERS " in *" $OWNER_NODE "*) ;; *) OWNERS="$OWNERS $OWNER_NODE" ;; esac
if [ "$DRY" != "1" ]; then
  bank_hosts_set_owners "$OWNERS"
fi

# ------------------------------------------------- 2. bundle + repo sync ----
log "[2/8] exporting the join bundle"
BUNDLE="$ROOT/dist-bank-bundles/bank${BANK_CODE}.tar.gz"
if [ "$DRY" = "1" ]; then
  echo "[dry-run] scripts/export-join-bundles.sh -> $BUNDLE"
else
  (cd "$ROOT" && ./scripts/export-join-bundles.sh >/dev/null)
  [ -f "$BUNDLE" ] || die "bundle missing: $BUNDLE"
  echo "    $BUNDLE"
fi

if [ "$REMOTE" = "1" ]; then
  if [ "$DO_SYNC" = "1" ]; then
    log "[3/8] syncing repo to $SSH_USER@$BANK_HOST:$REPO_DIR (first run is slow, then incremental)"
    if [ "$DRY" = "1" ]; then
      echo "[dry-run] rsync repo -> bank VM (excluding keys, DBs, node_modules, venvs)"
    else
      rsync -az --info=stats1 -e "ssh $SSH_OPTS" \
        --exclude node_modules --exclude .venv --exclude .git \
        --exclude 'token-services/keys' --exclude 'token-services/.ca-client' \
        --exclude 'backend/sworna.db*' --exclude 'network/organizations' \
        --exclude 'network/channel-artifacts' --exclude 'network/log.txt' \
        --exclude 'dist-bank-bundles' --exclude 'web/dist*' --exclude '__pycache__' \
        "$ROOT/" "${SSH_USER}@${BANK_HOST}:${REPO_DIR}/" \
        || die "repo sync failed (or use --no-sync if the bank VM already has the repo)"
    fi
  else
    log "[3/8] repo sync skipped (--no-sync)"
  fi
  if [ "$DRY" = "1" ]; then
    echo "[dry-run] scp bundle + tar xzf on the bank VM"
  else
    ssh_run "mkdir -p '$REPO_DIR'"
    scp_to "$BUNDLE" "${SSH_USER}@${BANK_HOST}:${REPO_DIR}/"
    ssh_run "cd '$REPO_DIR' && tar xzf bank${BANK_CODE}.tar.gz"
    echo "    bundle unpacked"
  fi
else
  log "[3/8] repo sync skipped (all-in-one mode)"
fi

# ------------------------------------------- 4. bank identity (remote) ------
log "[4/8] bank identity: own CA + peer + org enrollment"
IDENTITY_ENV="BANK_CODE=$BANK_CODE POOL_SIZE=$POOL_SIZE SWORNA_CB_HOST=$CB_HOST SWORNA_OWNERS='$OWNERS'$(owner_host_env)"
if [ "$DRY" = "1" ]; then
  echo "[dry-run] env $IDENTITY_ENV ./scripts/deploy-bank.sh $BANK_CODE identity"
else
  if [ "$REMOTE" = "1" ]; then
    ssh_run "cd '$REPO_DIR' && env $IDENTITY_ENV ./scripts/deploy-bank.sh $BANK_CODE identity"
    scp_from "${SSH_USER}@${BANK_HOST}:$REPO_DIR/network/${BANK_ORG}-org.json" "$ROOT/network/"
  else
    # owner host vars are already exported in this shell (load_bank_hosts)
    (
      export BANK_CODE="$BANK_CODE" POOL_SIZE="$POOL_SIZE" \
             SWORNA_CB_HOST="127.0.0.1" SWORNA_OWNERS="$OWNERS"
      "$ROOT/scripts/deploy-bank.sh" "$BANK_CODE" identity
    )
  fi
fi
ORG_JSON="$ROOT/network/${BANK_ORG}-org.json"

# ----------------------------------------------------- 5. host registry -----
log "[5/8] recording host IPs + cross-host DNS"
if [ "$REMOTE" = "1" ]; then
  if [ "$DRY" = "1" ]; then
    echo "[dry-run] bank-hosts.env: SWORNA_OWNER_${OWNER_NODE^^}_HOST=$BANK_HOST"
  else
    bank_hosts_upsert "SWORNA_OWNER_${OWNER_NODE^^}_HOST" "$BANK_HOST"
    bank_hosts_upsert "SWORNA_BANK_USER" "$SSH_USER"
    echo "    bank-hosts.env: SWORNA_OWNER_${OWNER_NODE^^}_HOST=$BANK_HOST"
  fi
fi
ensure_hosts_entry() {  # name ip — host-side resolution for the backend + peer CLI
  local name="$1" ip="$2"
  if [ "$DRY" = "1" ]; then echo "[dry-run] /etc/hosts: $ip $name"; return 0; fi
  if grep -qE "[[:space:]]${name}([[:space:]]|\$)" /etc/hosts 2>/dev/null; then return 0; fi
  if echo "$ip $name" | sudo -n tee -a /etc/hosts >/dev/null 2>&1; then
    echo "    /etc/hosts: $ip $name"
  else
    warn "could not update /etc/hosts on this host (no passwordless sudo). Run:"
    warn "  echo '$ip $name' | sudo tee -a /etc/hosts"
    return 1
  fi
}
HOSTS_FAILED=0
if [ "$REMOTE" = "1" ]; then
  ensure_hosts_entry "${OWNER_NODE}.sworna.example.com" "$BANK_HOST" || HOSTS_FAILED=1
  ensure_hosts_entry "peer0.${BANK_ORG}.sworna.example.com" "$BANK_HOST" || HOSTS_FAILED=1
else
  ensure_hosts_entry "${OWNER_NODE}.sworna.example.com" "127.0.0.1" || HOSTS_FAILED=1
fi

# --------------------------------------------- 6. onboard to the channel ----
log "[6/8] admitting $BANK_MSP to the 'settlement' channel (live)"
if [ "$DRY" = "1" ]; then
  echo "[dry-run] onboard-bank.sh $BANK_MSP $ORG_JSON"
else
  load_bank_hosts
  export SWORNA_OWNERS="$OWNERS"
  "$ROOT/scripts/onboard-bank.sh" "$BANK_MSP" "$ORG_JSON"
fi

# --------------------------------- 7. bank join + engine + backend + portal -
PHASE="finish"; [ "$START_PORTAL" = "0" ] && PHASE="finish-noportal"
JOIN_ENV="BANK_CODE=$BANK_CODE POOL_SIZE=$POOL_SIZE SWORNA_CB_HOST=$CB_HOST SWORNA_ORDERER_ADDR=$CB_HOST:7050 SWORNA_OWNERS='$OWNERS'$(owner_host_env)"
log "[7/8] bank VM: join channel, start owner engine + backend$( [ "$START_PORTAL" = 1 ] && echo ' + portal' )"
if [ "$DRY" = "1" ]; then
  echo "[dry-run] env $JOIN_ENV ./scripts/deploy-bank.sh $BANK_CODE $PHASE"
else
  if [ "$REMOTE" = "1" ]; then
    ssh_run "cd '$REPO_DIR' && env $JOIN_ENV ./scripts/deploy-bank.sh $BANK_CODE $PHASE"
  else
    (
      export BANK_CODE="$BANK_CODE" POOL_SIZE="$POOL_SIZE" \
             SWORNA_CB_HOST="127.0.0.1" SWORNA_OWNERS="$OWNERS" \
             SWORNA_ORDERER_ADDR="127.0.0.1:7050"
      "$ROOT/scripts/deploy-bank.sh" "$BANK_CODE" "$PHASE"
    )
  fi
fi

# ------------------------------------------------- 8. commit chaincode ------
if [ "$DO_COMMIT" = "1" ]; then
  log "[8/8] committing the chaincode endorsement policy (includes $BANK_MSP)"
  [ "$DRY" = "1" ] && echo "[dry-run] commit-chaincode.sh" || "$ROOT/scripts/commit-chaincode.sh"
else
  log "[8/8] skipped (--skip-commit)"
fi

# ------------------------------------------------------------ verify --------
if [ "$DRY" != "1" ]; then
  log "verifying"
  VERIFY_HOST="${BANK_HOST:-127.0.0.1}"
  if curl -sf -m 5 "http://${VERIFY_HOST}:${OWNER_PORT}/api/v1/readyz" >/dev/null 2>&1; then
    echo "    owner engine: READY  (http://${VERIFY_HOST}:${OWNER_PORT})"
  else
    warn "owner engine not reachable yet on :${OWNER_PORT} — FSC nodes take ~20 s to settle; retry shortly"
  fi
fi

echo
echo "Bank $BANK_CODE is onboarded and live."
echo "  staff login : $STAFF_USER / sworna-bank   (change after first login)"
echo "  portal      : http://${BANK_HOST:-localhost}:5173/b/$BANK_CODE"
echo "  next        : mint reserve to the bank from the CB console, then onboard customers"
if [ "$HOSTS_FAILED" != "0" ]; then
  echo
  echo "  NOTE: fix the /etc/hosts lines warned about above, then re-run this"
  echo "        command — it resumes where it stopped."
fi
