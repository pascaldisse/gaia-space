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
# Shared hosting caps threads per container; git's pack-objects defaults to one per core.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=pack.threads GIT_CONFIG_VALUE_0=1
cd "$root" && exec ./space-server 2>>"$root/data/stderr.log"
