#!/usr/bin/env bash
# Resolve requirements.in into a hash-pinned requirements.lock for the image's
# platform (CPython 3.13, linux/amd64). Run after editing requirements.in.
set -euo pipefail
cd "$(dirname "$0")/.."
uv pip compile requirements.in --quiet --generate-hashes \
  --python-version 3.13 --python-platform x86_64-manylinux_2_28 \
  --output-file requirements.lock --custom-compile-command "scripts/lock.sh"
echo "wrote requirements.lock ($(grep -c '==' requirements.lock) pins)"
