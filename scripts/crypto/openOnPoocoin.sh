#!/bin/sh

cd ~/.local/bin/bscanalyzer/ && ./bscanalyzer -noRPC -rpcEndpoint 'ws://100.73.57.3:8546' -action "openOnPoocoin,$(wl-paste)"
