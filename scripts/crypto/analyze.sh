#!/bin/sh

tx=$(wl-paste)
notify-send "Opening $tx"

cd /home/raph/sources/bscanalyzer && go run *.go -nodeType erigon -rpcEndpoint "ws://100.83.229.93:55332" -stage admin -action "analyzeSandwichAndOpenLink,$tx"
