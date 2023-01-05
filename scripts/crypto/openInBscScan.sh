#!/bin/sh

if [ "$(cat "$HOME/.scripts/crypto/mode")" = "bsc" ]; then
	firefox "https://bscscan.com/search?f=0&q=$(wl-paste)"
elif [ "$(cat "$HOME/.scripts/crypto/mode")" = "cronos" ]; then
	firefox "https://cronoscan.com/search?f=0&q=$(wl-paste)"
else
	firefox "https://polygonscan.com/search?f=0&q=$(wl-paste)"
fi
