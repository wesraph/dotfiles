#!/bin/sh
mkdir -p "$HOME/Screenshots/"
name="$HOME/Screenshots/$(date +'%Y-%m-%d-%H%M%S_grim.png')"
grim -g "$(slurp || slurp -o)" "$name"
wl-copy < "$name"
