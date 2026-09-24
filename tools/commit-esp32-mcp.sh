#!/usr/bin/env bash
# commit-esp32-mcp.sh - commit + push the dns_probe / serial-command work in ESP32-MCP and the lab fix. Configured identity, no force.
export SSH_AUTH_SOCK=/c/Users/DGMic/.ssh/agent.sock
{
cd /e/.ESP32-MCP || exit 1
echo "== ESP32-MCP  $(git config user.name) <$(git config user.email)>"
for f in firmware-arduino/Esp32_MCP_Node/secrets.h firmware-arduino/Pico_MCP_Node/secrets.h .env; do
  git check-ignore -q "$f" || { echo "REFUSING: $f is not ignored"; exit 1; }
done
echo "secrets ignored: yes"
git add server/app/models.py server/app/fleet/registry.py server/app/ingest/mqtt_bridge.py server/app/mcp/tools.py server/app/api/routes.py \
        scripts/serial_bridge.py scripts/start_lab.ps1 \
        firmware-arduino/Esp32_MCP_Node/Esp32_MCP_Node.ino firmware-arduino/Esp32_MCP_Node/config.h firmware-arduino/Pico_MCP_Node/Pico_MCP_Node.ino
git diff --cached --stat | tail -3
git commit -q -m "dns_probe: devices ask Gate^Flame via MCP send_command; replies kept + get_command_results tool; ESP32 fw 1.2.0 raw UDP probe; Pico fw 1.1.0 serial CMD/RES + host-bridge DNS relay; start_lab runs the server with python.exe (pythonw crashed uvicorn logging)" && git log -1 --format='%h %an %s'
git push origin HEAD 2>&1 | tail -2
echo "== Ionity lab"
cd /e/.IONITY-LAB && git add network/set_lab_wifi.ps1 && git commit -q -m "set_lab_wifi: skip projects without firmware (GateFlame) instead of throwing" && git push origin HEAD 2>&1 | tail -1
} 2>&1 | tee /e/Gateflame/tools/commit-esp32-mcp.last.txt
