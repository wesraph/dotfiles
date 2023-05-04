#!/bin/sh

if [ -f /dev/shm/last_path ]
then
    kitty -d "$(cat /dev/shm/last_path)"
else
    kitty
fi
