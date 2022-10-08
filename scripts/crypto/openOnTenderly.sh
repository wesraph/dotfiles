#!/bin/sh

if [ "$(cat "$HOME/.scripts/crypto/mode")" = "bsc" ]; then
	firefox "https://dashboard.tenderly.co/tx/bsc/$(wl-paste)"
else
	firefox "https://polygonscan.com/search?f=0&q=$(wl-paste)"
fi
