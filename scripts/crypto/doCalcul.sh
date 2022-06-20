#!/bin/sh
a="$(echo "$(wl-paste )" | bc -l)"
echo "$a"
notify-send "$a"
echo -n "$a" | wl-copy
