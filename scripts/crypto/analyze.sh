#!/bin/sh
set -e

. $HOME/.scripts/crypto/config

tx="$(wl-paste | sed -E 's/hash=//g')"
notify-send "Opening $tx"

if [ "$(cat $HOME/.scripts/crypto/mode)" = "bsc" ]; then
	ENDPOINT=$BSC_ENDPOINT
else
	ENDPOINT=$POLYGON_ENDPOINT
fi

cd "$HOME/.local/bin/bscanalyzer" && ./bscanalyzer --chain "$(cat $HOME/.scripts/crypto/mode)" --rpcEndpoint "$ENDPOINT" --stage admin actions cli analyzeSandwichAndOpenLink "$tx"
