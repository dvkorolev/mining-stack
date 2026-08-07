#!/bin/bash
# Shared helpers for the Pi deploy scripts (quick-deploy.sh, deploy-to-pi-registry.sh,
# deploy-optimized.sh, pi-quick-update.sh). Source this file; do not execute directly.
#
# Single source of truth for finding the Pi's current address, so the deploy scripts
# don't each carry their own (and inevitably drifting) copy of the host list.

PI_USER="${PI_USER:-admin}"

if [ -z "${PI_HOSTS:-}" ]; then
  PI_HOSTS=("192.168.2.63" "100.119.15.37")  # LAN (DHCP, may drift), Tailscale
else
  # allow PI_HOSTS to be passed as a space-separated string via env
  read -r -a PI_HOSTS <<< "${PI_HOSTS}"
fi

# Prints the first reachable Pi host to stdout and returns 0, or prints an error to
# stderr and returns 1. If PI_HOST is already set (explicit override), skips discovery
# and uses it directly.
find_pi_host() {
  if [ -n "${PI_HOST:-}" ]; then
    echo "${PI_HOST}"
    return 0
  fi

  local host
  for host in "${PI_HOSTS[@]}"; do
    if ssh -o ConnectTimeout=5 -o BatchMode=yes "${PI_USER}@${host}" "echo ok" >/dev/null 2>&1; then
      echo "${host}"
      return 0
    fi
  done

  echo "Cannot reach Pi on any known address (${PI_HOSTS[*]})" >&2
  return 1
}

# Idempotent buildx builder setup: reuses an existing named builder instead of
# erroring on re-create, and always selects it as current.
ensure_buildx_builder() {
  local name="$1"
  if docker buildx inspect "${name}" >/dev/null 2>&1; then
    docker buildx use "${name}"
  else
    docker buildx create --name "${name}" --use
    docker buildx inspect --bootstrap
  fi
}
