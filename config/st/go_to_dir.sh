#!/bin/sh

ST="st"
if [ "$1" = "lowres" ]; then
    ST="stLowRes"
fi


if [ -f /dev/shm/last_path ]
then
    $ST sh -c "cd \"$(cat /dev/shm/last_path)\" && zsh "
else
    $ST
fi
