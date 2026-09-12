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
