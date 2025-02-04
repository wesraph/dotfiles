#!/bin/sh
link="$(wl-paste | sed 's/^.*0x/0x/g' | sed 's/\\x/0x/g' | sed 's/\\$//g')"

if [ "$(cat "$HOME/.scripts/crypto/mode")" = "bsc" ]; then
	firefox "https://bscscan.com/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "cronos" ]; then
	firefox "https://cronoscan.com/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "polygon" ]; then
	firefox "https://polygonscan.com/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "ethereum" ]; then
	firefox "https://etherscan.io/search?f=0&q=$link"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "optimism" ]; then
	firefox "https://optimistic.etherscan.io/search?f=0&q=$link"
fi
