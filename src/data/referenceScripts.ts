/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame reference deployment scripts
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

/**
 * Reference shell scripts shown read-only in the developer shell
 * (DeploymentScriptViewer). They are documentation of the appliance install
 * sequence, not data the UI claims to have measured. The authoritative,
 * executable copies live in node-agent/*.sh — keep these in step with them.
 */

export const SCRIPT_AUTOPILOT = `#!/bin/bash
# Network Autopilot for Headless Deployment
# File Path: /usr/local/bin/network_autopilot.sh
# Ionity Global (Pty) Ltd — Gate^Flame Security Node

CHECK_HOST="8.8.8.8"
HOTSPOT_SSID="PiHole_Config_Setup"
LOG_FILE="/var/log/network_autopilot.log"

log_msg() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> $LOG_FILE
}

check_connection() {
  log_msg "Checking internet connectivity..."
  if ping -q -c 1 -W 5 $CHECK_HOST >/dev/null; then
    log_msg "Internet connection confirmed."
    return 0
  else
    log_msg "No internet connection detected."
    return 1
  fi
}

activate_hotspot() {
  log_msg "Activating Failover Hotspot..."
  systemctl stop wpa_supplicant
  ip link set wlan0 down
  ip addr flush dev wlan0
  ip link set wlan0 up
  ip addr add 192.168.4.1/24 dev wlan0
  systemctl start dnsmasq
  systemctl start hostapd
  log_msg "Hotspot active. SSID: $HOTSPOT_SSID IP: 192.168.4.1"
}

# Main Execution Flow
sleep 15
if check_connection; then
  exit 0
else
  log_msg "Attempting interface reset..."
  systemctl restart wpa_supplicant
  sleep 15
  if check_connection; then
    exit 0
  else
    activate_hotspot
  fi
fi`;

export const SCRIPT_DEPLOY = `#!/bin/bash
# Automated Pi-hole Deployment Injector
# File Path: /opt/scripts/deploy_pihole.sh
# Usage: sudo /opt/scripts/deploy_pihole.sh "YourSecurePassword"

WEBPASSWORD_INPUT=$1
if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root"
  exit 1
fi

if [ -z "$WEBPASSWORD_INPUT" ]; then
  echo "Error: No web password provided."
  exit 1
fi

# 1. Dynamic Network Detection (Wired Ethernet vs. Wi-Fi)
ACTIVE_IFACE=$(ip route get 1.1.1.1 | grep -oP 'dev \\K\\S+')
CURRENT_IP=$(ip -o -4 addr list $ACTIVE_IFACE | awk '{print $4}' | cut -d/ -f1)

echo "Detected Interface: $ACTIVE_IFACE"
echo "Detected IP: $CURRENT_IP"

# 2. Double SHA-256 Hashing for Pi-hole Web Admin
HASH=$(echo -n "$WEBPASSWORD_INPUT" | sha256sum | awk '{printf $1}' | sha256sum | awk '{printf $1}')

# 3. Pre-seed Configuration to bypass interactive prompts
mkdir -p /etc/pihole
cat <<EOF > /etc/pihole/setupVars.conf
PIHOLE_INTERFACE=$ACTIVE_IFACE
IPV4_ADDRESS=$CURRENT_IP/24
IPV6_ADDRESS=
QUERY_LOGGING=true
INSTALL_WEB_SERVER=true
INSTALL_WEB_INTERFACE=true
LIGHTTPD_ENABLED=true
WEBPASSWORD=$HASH
DNSMASQ_LISTENING=local
PIHOLE_DNS_1=127.0.0.1#5335
PIHOLE_DNS_2=1.1.1.1
DNS_FQDN_REQUIRED=true
DNS_BOGUS_PRIV=true
TEMPERATURE_UNIT=C
WEBUIBOXEDLAYOUT=boxed
WEBTHEME=default-dark
EOF

echo "Starting Unattended Installation..."
export USER=root
curl -sSL https://install.pi-hole.net | bash /dev/stdin --unattended
echo "Gate^Flame Deployment Complete."`;

export const SCRIPT_UNBOUND = `#!/bin/bash
# Recursive DNS (Unbound) Hardening Installer
# File Path: /opt/scripts/install_unbound.sh

apt-get install -y unbound
wget https://www.internic.net/domain/named.root -qO- | sudo tee /var/lib/unbound/root.hints

cat <<EOF > /etc/unbound/unbound.conf.d/pi-hole.conf
server:
    verbosity: 0
    interface: 127.0.0.1
    port: 5335
    do-ip4: yes
    do-udp: yes
    do-tcp: yes
    do-ip6: no
    harden-glue: yes
    harden-dnssec-stripped: yes
    use-caps-for-id: no
    edns-buffer-size: 1232
    prefetch: yes
    num-threads: 1
    so-rcvbuf: 1m
    private-address: 192.168.0.0/16
EOF

service unbound restart
echo "Unbound Installed. Local Recursive DNS listening on 127.0.0.1#5335"`;

export const SCRIPT_PADD = `#!/bin/bash
# PADD Setup and Kiosk Mode Configuration for 3.5" or 7" Display
# File Path: /opt/scripts/install_padd.sh

cd /home/pi
wget -N https://raw.githubusercontent.com/pi-hole/PADD/master/padd.sh
chmod +x padd.sh

usermod -aG pihole pi

if ! grep -q "padd.sh" /home/pi/.bashrc; then
  cat <<EOF >> /home/pi/.bashrc
if [ "$TERM" == "linux" ]; then
  while :
  do
    ./padd.sh
    sleep 1
  done
fi
EOF
  echo "PADD Auto-start configured on TTY1."
fi`;
