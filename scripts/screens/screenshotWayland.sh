#!/bin/sh
name="$HOME/$(date +'%Y-%m-%d-%H%M%S_grim.png')"
grim -g "$(slurp)" "$name"
wl-copy < "$name"
