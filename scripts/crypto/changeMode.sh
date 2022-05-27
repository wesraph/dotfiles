#!/bin/sh
mode="$(cat mode)"

if [ "$mode" = "bsc" ]; then
	notify-send "Crypto" "Switching mode to polygon"
	echo -n "polygon" > mode
else
	notify-send "Crypto" "Switching mode to bsc"
	echo -n "bsc" > mode
fi
