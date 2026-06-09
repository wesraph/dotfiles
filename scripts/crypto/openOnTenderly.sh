#!/bin/sh

link="$(wl-paste | sed -E 's/hash=|txHash=//g')"

if [ "$(cat "$HOME/.scripts/crypto/mode")" = "bsc" ]; then
	$BROWSER "https://explorer.phalcon.xyz/tx/bsc/$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "ethereum" ]; then
	$BROWSER "https://explorer.phalcon.xyz/tx/eth/$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "base" ]; then
	$BROWSER "https://explorer.phalcon.xyz/tx/base/$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "optimism" ]; then
	$BROWSER "https://app.blocksec.com/explorer/tx/optimism/$link"
fi
