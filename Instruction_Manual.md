# Gate^Flame™ Instruction Manual
**Ionity Global (Pty) Ltd**

Welcome to Gate^Flame™, the ultimate network security architecture combining recursive DNS, unyielding blocklists, and next-generation API monitoring.

## 1. System Overview
Gate^Flame acts as a network autopilot, protecting connected devices from telemetry collection, malware, and intrusive advertising at the DNS level.
The system consists of:
- **Master Node:** A physical Raspberry Pi / Orange Pi handling recursive DNS (Unbound) and blocklist checking (Pi-hole engine).
- **Dashboard UI:** A web-based or mobile application to visualize blocked threats in real-time.

## 2. Installation (Master Node)
To set up the Master Node, you only need to run the provided installer.
1. Flash a fresh Debian/Raspbian OS onto your SD card and boot the Pi.
2. Connect the Pi to your router via Ethernet.
3. SSH into the Pi.
4. Transfer the `gateflame_master_installer.sh` script to the Pi.
5. Make it executable: `chmod +x gateflame_master_installer.sh`
6. Run the script as root: `sudo ./gateflame_master_installer.sh`

The script will automatically provision the environment with static IPs, the Pi-hole subsystem, and Unbound caching.

## 3. Network Configuration
After the Master Node is installed, you must tell your devices to use it.
1. Log into your main Wi-Fi Router's Admin Panel.
2. Navigate to **DHCP Settings**.
3. Change the **Primary DNS Server** to the static IP address of your Master Node.
4. Reboot your router or disconnect/reconnect your devices. 
*All traffic will now flow through the Gate^Flame layer.*

## 4. Mobile Dashboard Setup
You can view stats via the web interface or by building the Android App.
- To run the standalone HTML version, simply open `gateflame_mobile_app.html` in any modern browser.
- To build the Android APK, follow the `Android_APK_Build_Guide.md`.

## 5. Future Expansion (Phase 2)
Gate^Flame includes placeholders for the following LATER modules:
- **AI Sentinel NPU Anomaly Detection**
- **Suricata IPS/IDS**
- **Captive Portal MAC Cloning**
- **Hospitality Room SCADA Grid**
- **Signed OTA Firmware Engine**

When these features are rolled out via OTA, your system will automatically enable them in the Dashboard.

## 6. Maintenance & Troubleshooting
- **Internet is down?** Ensure the Master Node is powered on and the ethernet cable is connected. If the node dies, devices using it for DNS will not be able to resolve web pages.
- **False Positives:** If a legitimate site breaks, you can manually whitelist domains via the Pi-hole admin panel or API.
