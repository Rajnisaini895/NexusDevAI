#!/usr/bin/env bash

set -euo pipefail

: "${DUCKDNS_DOMAIN:?Set DUCKDNS_DOMAIN to the subdomain without .duckdns.org}"
: "${DUCKDNS_TOKEN:?Set DUCKDNS_TOKEN to your DuckDNS token}"

response="$({
  curl --fail --silent --show-error --get \
    --data-urlencode "domains=${DUCKDNS_DOMAIN}" \
    --data-urlencode "token=${DUCKDNS_TOKEN}" \
    --data-urlencode "ip=" \
    https://www.duckdns.org/update
} 2>&1)"

if [[ "${response}" != "OK" ]]; then
  printf 'DuckDNS update failed: %s\n' "${response}" >&2
  exit 1
fi

printf 'DuckDNS record updated for %s.duckdns.org\n' "${DUCKDNS_DOMAIN}"
