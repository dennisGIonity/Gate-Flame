#!/usr/bin/env bash
# pytest-one.sh <node-agent test selector> - verbose run of one test, output to pytest-one.last.txt
cd /e/Gateflame/node-agent
GATEFLAME_DB_PATH="$(mktemp -d)/state.db" .venv/Scripts/python.exe -m pytest -x -q -p no:cacheprovider "$@" > /e/Gateflame/tools/pytest-one.last.txt 2>&1
tail -80 /e/Gateflame/tools/pytest-one.last.txt
