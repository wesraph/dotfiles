#!/bin/sh

link="$(wl-paste | sed -E 's/hash=|txHash=//g')"

if [ "$(cat "$HOME/.scripts/crypto/mode")" = "bsc" ]; then
	firefox "https://explorer.phalcon.xyz/tx/bsc/$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "ethereum" ]; then
	firefox "https://explorer.phalcon.xyz/tx/eth/$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "base" ]; then
	firefox "https://explorer.phalcon.xyz/tx/base/$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "optimism" ]; then
	firefox "https://app.blocksec.com/explorer/tx/optimism/$link"
fi
