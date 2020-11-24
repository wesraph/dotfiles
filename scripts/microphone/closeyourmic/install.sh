#!/bin/sh
set -e

echo "Installing on /usr/sbin/closeyourmic"
sudo cp closeyourmic /usr/sbin/closeyourmic -fv

if [ -d /etc/systemd/user/ ]; then
    dialog --title "Systemd unit" \
    --backtitle "Installation" \
    --yesno "Do you want to install the systemd unit ?" 7 60

    response=$?
    if [ "$response" ]; then
        sudo cp closeyourmic.service /etc/systemd/user/closeyourmic.service -fv
        sudo systemctl daemon-reload
    fi

    dialog --title "Systemd unit" \
    --backtitle "Installation" \
    --yesno "Do you want to run it at boot time ?" 7 60
    response=$?

    if [ "$response" ]; then
        systemctl --user enable closeyourmic.service
    fi
fi
