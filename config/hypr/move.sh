#!/bin/sh
dir="$1"
ret="$(hyprctl activewindow -j)"
windowID="$(echo "$ret" | jq -r ".address")"
if [ "$dir" = "r" ]; then
	lastGrouped="$(echo "$ret" | jq -r ".grouped | .[]" | tail -n1)"
	if [ "$lastGrouped" = "$windowID" ] || [ "$lastGrouped" = "" ]; then
		hyprctl dispatch movefocus r
	else
		hyprctl dispatch changegroupactive f
	fi
else
	firstGrouped="$(echo "$ret" | jq -r ".grouped | .[]" | head -n1)"
	if [ "$firstGrouped" = "$windowID" ] || [ "$firstGrouped" = "" ];  then
		hyprctl dispatch movefocus l
	else
		hyprctl dispatch changegroupactive b
	fi
fi
