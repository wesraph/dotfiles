#Key repetition
xset r rate 200 50

#Cursor speed
xinput --set-prop 13 'libinput Accel Speed' 0.75

#Keyboard intl
setxkbmap -layout us -option compose:ralt

#Disable keyboard while typing
syndaemon -i 0.5 -m 100 -d

#Scale GDK to high dpi
export GDK_SCALE=2
export GDK_DPI_SCALE=0.95
export QT_SCREEN_SCALE_FACTORS=0.9
export QT_AUTO_SCREEN_SCALE_FACTOR=2
export QT_SCALE_FACTOR=2

xflux -l 50.633333 -g 3.066667

#Compton for jacky transparancy
compton  -b -C

#Slow nautilus
dbus-update-activation-environment --systemd DBUS_SESSION_BUS_ADDRESS DISPLAY XAUTHORITY

#Notifications
dunst &

#Lock on sleep
xss-lock -- betterlockscreen -l &

synclient PalmDetect=1

exec i3
