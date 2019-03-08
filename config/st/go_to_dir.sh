#!/bin/sh
PATH=$PATH:~/.local/bin

if [ -f /dev/shm/last_path ]
then
    /home/rwestpha/.bin/st sh -c "cd \"$(cat /dev/shm/last_path)\" && zsh "
else
    /home/rwestpha/.bin/st
fi
