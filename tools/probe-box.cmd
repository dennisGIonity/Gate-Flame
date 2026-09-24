@echo off
rem probe-box.cmd <ip> — read-only: agent status, kiosk, Pi-hole admin, and two DNS
rem lookups through the box. Prints HTTP codes; never writes anything to the box.
set BOX=%1
if "%BOX%"=="" set BOX=192.168.124.17
echo === %BOX% ===
curl -s -m 6 -w "status  [%%{http_code}] %%{time_total}s\n" http://%BOX%:8080/api/v1/system/status
echo.
curl -s -m 6 -w "kiosk   [%%{http_code}]\n" -o NUL http://%BOX%:8080/api/v1/system/kiosk
curl -s -m 6 -w "feed    [%%{http_code}]\n" -o NUL http://%BOX%:8080/api/v1/system/feed
curl -s -m 6 -w "filter  [%%{http_code}]\n" -o NUL http://%BOX%:8080/api/v1/filtering
curl -s -m 6 -w "kioskUI [%%{http_code}]\n" -o NUL -L http://%BOX%:8080/device-kiosk/
curl -s -m 6 -w "pihole  [%%{http_code}]\n" -o NUL http://%BOX%:8081/admin/
curl -s -m 6 -w "ssh     [%%{http_code}] %%{errormsg}\n" -o NUL telnet://%BOX%:22
echo --- DNS via %BOX% ---
nslookup -timeout=3 doubleclick.net %BOX% 2>&1 | findstr /v "^$"
nslookup -timeout=3 ionity.today %BOX% 2>&1 | findstr /v "^$"
