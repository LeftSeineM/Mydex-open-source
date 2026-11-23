#!/bin/sh
# Run with sh; no terminal windows, sudo, Coding tool installation or patching.
set -eu
PACKAGE=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
if [ "$#" -ne 1 ]; then
 printf '%s\n' 'Usage: sh desktop/headless/install.sh /absolute/chosen/MydexAgent'
 exit 2
fi
chmod u+x "$PACKAGE/runtime/bin/node"
exec "$PACKAGE/runtime/bin/node" "$PACKAGE/desktop/headless/manage-posix.mjs" --action install --root "$1" --package "$PACKAGE"
