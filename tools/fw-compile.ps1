# fw-compile.ps1 - compile the ESP32 + Pico sketches (no upload). Output -> fw-compile.last.txt
$acli = 'E:\Program Files (x86)\ArduinoIDE\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
$fw = 'E:\.ESP32-MCP\firmware-arduino'
& {
  "=== fw-compile $(Get-Date -Format s) ==="
  Select-String -Path "$fw\Esp32_MCP_Node\secrets.h","$fw\Pico_MCP_Node\secrets.h" -Pattern '#define WIFI_SSID' | ForEach-Object { "$($_.Filename): $($_.Line)" }
  Select-String -Path "$fw\Esp32_MCP_Node\config.h" -Pattern 'SERVER_HOST_FALLBACK' | ForEach-Object { $_.Line }
  "--- ESP32-S3 ---"
  & $acli compile --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=min_spiffs' --build-path "$fw\.build-s3" --log-level warn "$fw\Esp32_MCP_Node" 2>&1 | Select-Object -Last 12
  "esp32 rc=$LASTEXITCODE"
  "--- Pico 2 ---"
  & $acli board listall rp2040 2>&1 | Select-String 'pico2' | Select-Object -First 4
  & $acli compile --fqbn 'rp2040:rp2040:rpipico2' --build-path "$fw\.build-pico2" --log-level warn "$fw\Pico_MCP_Node" 2>&1 | Select-Object -Last 12
  "pico rc=$LASTEXITCODE"
} *>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot 'fw-compile.last.txt')
