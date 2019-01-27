#!/bin/sh

if [ -f /dev/shm/last_path ]
then
    alacritty --working-directory "$(cat /dev/shm/last_path)" 
else 
    alacritty
fi
