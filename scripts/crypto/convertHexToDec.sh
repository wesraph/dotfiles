#!/bin/sh
set -e
v="$(wl-paste | sed -E 's/^0x//g' |  tr '[a-z]' '[A-Z]')"
a="$(perl -le 'print hex("'$v'")')"
wl-copy "$a"
notify-send "$a"
