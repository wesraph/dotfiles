#!/bin/sh

if [ ! -f "/tmp/agentTime" ]; then
	echo ""
	exit 0
fi

echo "$(cat "/tmp/agentTime"):$(date "+%H:%M:%S")" | awk -F":" '{a=$3+$2*60+$1*60*60; b=$6+$5*60+$4*60*60; print int((a-b) / 60)}'
