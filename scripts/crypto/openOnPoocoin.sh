#!/bin/sh
set -e
. ./config

cd ~/.local/bin/bscanalyzer/ && ./bscanalyzer -rpcEndpoint "$ENDPOINT" -action "openOnPoocoin,$(wl-paste)"
