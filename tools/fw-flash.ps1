# fw-flash.ps1 [-Board esp32|pico|both] - recompile (incremental, picks up lab secrets.h) and flash over USB.
# ESP32-S3 on COM8 (CH340). Pico 2 found by USB VID 2E8A; the serial bridge is paused while its port is flashed.
param([ValidateSet('esp32','pico','both')][string]$Board = 'both', [string]$EspPort = 'COM8')
$acli = 'E:\Program Files (x86)\ArduinoIDE\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
$fw = 'E:\.ESP32-MCP\firmware-arduino'
& {
  "=== fw-flash $Board $(Get-Date -Format s) ==="
  "secrets SSID: " + ((Select-String -Path "$fw\Esp32_MCP_Node\secrets.h" -Pattern '#define WIFI_SSID').Line)
  if ($Board -in 'esp32','both') {
    $fq = 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=min_spiffs'
    & $acli compile --fqbn $fq --build-path "$fw\.build-s3" --log-level warn "$fw\Esp32_MCP_Node" 2>&1 | Select-Object -Last 3
    & $acli upload --fqbn $fq --port $EspPort --build-path "$fw\.build-s3" "$fw\Esp32_MCP_Node" 2>&1 | Select-Object -Last 6
    "esp32 upload rc=$LASTEXITCODE"
  }
  if ($Board -in 'pico','both') {
    $pp = (Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_2E8A' -and $_.Name -match '\((COM\d+)\)' } | ForEach-Object { $Matches[1] } | Select-Object -First 1)
    "pico port: $pp"
    & $acli compile --fqbn rp2040:rp2040:rpipico2 --build-path "$fw\.build-pico2" --log-level warn "$fw\Pico_MCP_Node" 2>&1 | Select-Object -Last 3
    # free the port: stop the bridge, flash, restart it
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like '*serial_bridge.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Sleep 2
    if ($pp) { & $acli upload --fqbn rp2040:rp2040:rpipico2 --port $pp --build-path "$fw\.build-pico2" "$fw\Pico_MCP_Node" 2>&1 | Select-Object -Last 6 }
    else { & $acli upload --fqbn rp2040:rp2040:rpipico2 --build-path "$fw\.build-pico2" "$fw\Pico_MCP_Node" 2>&1 | Select-Object -Last 6 }
    "pico upload rc=$LASTEXITCODE"
    Start-Sleep 4
    Start-Process -FilePath 'E:\.ESP32-MCP\.venv\Scripts\pythonw.exe' -ArgumentList 'E:\.ESP32-MCP\scripts\serial_bridge.py' -WorkingDirectory 'E:\.ESP32-MCP' -RedirectStandardOutput 'E:\.ESP32-MCP\bridge_out.txt' -WindowStyle Hidden
    "bridge restarted"
  }
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'fw-flash.last.txt')
