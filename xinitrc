#!/bin/sh

xrandr --auto --output HDMI3 --mode 1920x1080 --left-of HDMI2
xrandr --auto --output HDMI1 --mode 1366x768 --left-of HDMI3
setxkbmap -layout us -option compose:ralt
xset r rate 200 60
xbindkeys
FONTDIR="$HOME/.local/share/fonts"
xset +fp "$FONTDIR"
