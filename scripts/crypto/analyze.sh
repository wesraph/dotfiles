#!/bin/sh
set -e

. ./config

tx=$(wl-paste)
notify-send "Opening $tx"

cd "$HOME/.local/bin/bscanalyzer" && ./bscanalyzer -rpcEndpoint "$ENDPOINT" -stage admin -action "analyzeSandwichAndOpenLink,$tx"
