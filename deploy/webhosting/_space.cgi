#!/bin/sh
# gaia-space CGI front: one request -> one space-server process (webhosting, no daemons).
# Plain CGI, not PHP: PHP-FPM drops chunked request bodies (git push > 1 MiB); Apache
# passes them through framed and space-server de-chunks.
root=$(cd "$(dirname "$0")/../../space" && pwd) || exit 1
set -a
[ -f "$root/space.env" ] && . "$root/space.env"
set +a
path=${REQUEST_URI%%\?*}
export GATEWAY_INTERFACE=${GATEWAY_INTERFACE:-CGI/1.1} SPACE_PATH=${path#/space} \
  SPACE_DB=${SPACE_DB:-$root/data/space.db} HOME=$root
# Shared hosting caps threads per container (pack-objects defaults to one per core) and
# address space at 2 GiB (`ulimit -v`); git's 64-bit defaults mmap 1 GiB pack windows up to
# 8 GiB → pack-objects died serving the 1.2 GB empire-earth clone (10-09) → cap every window.
export GIT_CONFIG_COUNT=6 \
  GIT_CONFIG_KEY_0=pack.threads GIT_CONFIG_VALUE_0=1 \
  GIT_CONFIG_KEY_1=core.packedGitWindowSize GIT_CONFIG_VALUE_1=32m \
  GIT_CONFIG_KEY_2=core.packedGitLimit GIT_CONFIG_VALUE_2=256m \
  GIT_CONFIG_KEY_3=pack.windowMemory GIT_CONFIG_VALUE_3=64m \
  GIT_CONFIG_KEY_4=pack.deltaCacheSize GIT_CONFIG_VALUE_4=32m \
  GIT_CONFIG_KEY_5=core.deltaBaseCacheLimit GIT_CONFIG_VALUE_5=32m
cd "$root" && exec ./space-server 2>>"$root/data/stderr.log"
