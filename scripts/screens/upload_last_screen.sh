#!/bin/sh
plik $HOME/"$(ls "$HOME" | grep -E '2[0-9]{3}-[0-9]{2}-[0-9]{2}-[0-9]{6}_grim\.png' | sort | tail -n 1)" | tail -n1 | cut -d'"' -f2 | wl-copy | notify-send "Screen"  "Uploaded !"
