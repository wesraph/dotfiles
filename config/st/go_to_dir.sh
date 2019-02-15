#!/bin/sh

if [ -f /dev/shm/last_path ]
then
    st sh -c "cd \"$(cat /dev/shm/last_path)\" && zsh "
else
   st
fi
