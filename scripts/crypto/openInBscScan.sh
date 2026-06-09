#!/bin/sh
link="$(wl-paste | sed 's/^.*0x/0x/g' | sed 's/\\x/0x/g' | sed 's/\\$//g')"

if [ "$(cat "$HOME/.scripts/crypto/mode")" = "bsc" ]; then
	$BROWSER "https://bscscan.com/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "cronos" ]; then
	$BROWSER "https://cronoscan.com/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "polygon" ]; then
	$BROWSER "https://polygonscan.com/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "ethereum" ]; then
	$BROWSER "https://etherscan.io/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "optimism" ]; then
	$BROWSER "https://optimistic.etherscan.io/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "arbitrum" ]; then
	$BROWSER "https://arbiscan.io/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "base" ]; then
	$BROWSER "https://basescan.org/search?f=0&q=$link"
fi
