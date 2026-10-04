#!/usr/bin/env bash
# Rebuild the app from the checked-out source and restart the systemd unit.
# hq.service serves the prebuilt dist/ directory, so edits do nothing until
# this runs. Run it from anywhere: it works relative to the repository root.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart hq.service
systemctl status hq.service --no-pager

# Pay the remaining cold-request cost here, after the service is listening.
# This entire block is best-effort, including under set -e.
if (
  warm_origin=http://127.0.0.1
  warm_deadline=$((SECONDS + 30))
  until curl --silent --fail --output /dev/null --connect-timeout 1 --max-time 1 "$warm_origin/"; do
    if (( SECONDS >= warm_deadline )); then
      exit 1
    fi
    sleep 1
  done

  warm_count=0
  for warm_path in / /content /nasr /github; do
    if curl --silent --fail --location --output /dev/null --connect-timeout 1 --max-time 5 "$warm_origin$warm_path"; then
      warm_count=$((warm_count + 1))
    fi
  done
  printf '[hq] Deploy warm-up: %s/4 pages ready.\n' "$warm_count"
); then
  :
else
  printf '[hq] Deploy warm-up skipped: service unavailable after 30 s.\n'
fi
