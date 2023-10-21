#!/bin/sh
set -e
. $HOME/.scripts/crypto/config

cd ~/.local/bin/bscanalyzer/ && ./bscanalyzer --rpcEndpoint "$ENDPOINT" actions cli  openOnPooCoin "$(wl-paste)"
