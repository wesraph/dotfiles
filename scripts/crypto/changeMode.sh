#!/bin/sh
mode="$(cat $HOME/.scripts/crypto/mode)"

if [ "$mode" = "bsc" ]; then
	notify-send "Crypto" "Switching mode to polygon"
	echo -n "polygon" > "$HOME/.scripts/crypto/mode"
elif [ "$mode" = "polygon" ]; then
	notify-send "Crypto" "Switching mode to cronos"
	echo -n "cronos" > "$HOME/.scripts/crypto/mode"
else
	notify-send "Crypto" "Switching mode to bsc"
	echo -n "bsc" > "$HOME/.scripts/crypto/mode"
fi
