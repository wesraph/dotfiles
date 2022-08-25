#Key repetition
xset r rate 200 50

#Cursor speed
xinput --set-prop 13 'libinput Accel Speed' 0.75

#Keyboard intl
setxkbmap -layout us -option "compose:ralt,caps:escape"

#Disable keyboard while typing
syndaemon -i 0.5 -m 100 -d

#xflux -l 50.633333 -g 3.066667

#Slow nautilus
dbus-update-activation-environment --systemd DBUS_SESSION_BUS_ADDRESS DISPLAY XAUTHORITY

#Lock on sleep
#xss-lock -- betterlockscreen -l &

synclient PalmDetect=1

exec i3
