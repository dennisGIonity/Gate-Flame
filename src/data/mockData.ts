/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame Mock Data & Script Constants
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import { HardwareTierInfo, NetworkOption, SystemTelemetry, ThreatLogEntry, ConnectedClient, IonityUserAccount } from '../types';

export const HARDWARE_TIERS: HardwareTierInfo[] = [
  {
    id: 'tier1_mini',
    name: 'Device 1: Minimalist Node',
    subtitle: 'Pocket-Sized Privacy & Travel Security',
    targetMarket: 'Travelers, Small Apartments, Headless Stealth',
    baseCostZAR: 596.49,
    retailPriceZAR: 745.61,
    cpu: 'Quad-Core ARM Cortex-A53 @ 1.0GHz',
    ram: '512MB LPDDR2',
    qps: 500,
    maxClients: 50,
    cooling: '7mm Passive Aluminium Heatsink',
    display: 'Headless (Hotspot Failover + App)',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  },
  {
    id: 'tier2_wired',
    name: 'Device 2: High-Reliability Wired Node',
    subtitle: 'Zero-Latency SME & Gaming Defense',
    targetMarket: 'Remote Workers, Small Businesses, VoIP & Gaming',
    baseCostZAR: 792.44,
    retailPriceZAR: 990.55,
    cpu: 'Quad-Core ARM Cortex-A53 @ 1.0GHz',
    ram: '512MB LPDDR2',
    qps: 500,
    maxClients: 100,
    cooling: '7mm Passive Aluminium Heatsink',
    display: 'Headless + Physical RJ45 Ethernet HAT (<2ms)',
    badgeColor: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  },
  {
    id: 'tier3_visual',
    name: 'Device 3: Visual Interactive Node',
    subtitle: 'Prosumer Touch Kiosk with PADD Stats',
    targetMarket: 'Digital Guardians, Families, Home Offices',
    baseCostZAR: 1004.67,
    retailPriceZAR: 1255.84,
    cpu: 'Quad-Core ARM Cortex-A53 / ARM64',
    ram: '512MB - 1GB',
    qps: 500,
    maxClients: 100,
    cooling: '7mm Passive Heatsink assembly',
    display: '3.5" IPS Capacitive Touch Display (PADD)',
    badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  },
  {
    id: 'tier4_ai',
    name: 'Device 4: AI "Sentinel" Enterprise Node',
    subtitle: 'Neural Anomaly Detection & High-Density NOC',
    targetMarket: 'Hotels, Malls, Corporate HQs, Public Venues',
    baseCostZAR: 6753.06,
    retailPriceZAR: 8297.37,
    cpu: 'Quad-Core Cortex-A76 @ 2.4GHz + AI HAT+ (26 TOPS NPU)',
    ram: '16GB LPDDR4X (32x Capacity)',
    qps: 5000,
    maxClients: 1000,
    cooling: 'Active Cooler (Aluminium Heatsink + PWM Fan)',
    display: 'Official 7" Touchscreen + UPS Battery HAT',
    badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/40',
  },
];

export const MOCK_NETWORKS: NetworkOption[] = [
  {
    id: 'eth0',
    ssid: 'Wired Ethernet Connection (RJ45 CAT5e)',
    type: 'ethernet',
    secured: true,
    ipAddress: '192.168.1.105',
  },
  {
    id: 'wifi_ionity_office',
    ssid: 'Ionity_Secure_Corporate_5G',
    type: 'wifi',
    signalStrength: 98,
    secured: true,
    frequency: '5.0 GHz',
  },
  {
    id: 'wifi_home_guest',
    ssid: 'Home_Fiber_Optics_WiFi',
    type: 'wifi',
    signalStrength: 85,
    secured: true,
    frequency: '2.4 GHz / 5 GHz',
  },
  {
    id: 'wifi_hotel_lounge',
    ssid: 'Grand_Hotel_Guest_WiFi (Captive Portal)',
    type: 'wifi',
    signalStrength: 72,
    secured: false,
    frequency: '2.4 GHz',
  },
  {
    id: 'wifi_mesh_node',
    ssid: 'Gate^Flame_Mesh_Node_02',
    type: 'wifi',
    signalStrength: 91,
    secured: true,
    frequency: '5.0 GHz',
  },
];

export const INITIAL_TELEMETRY: SystemTelemetry = {
  totalQueriesToday: 38851,
  queriesBlockedToday: 14397,
  blockPercentage: 37.1,
  domainsOnGravity: 6755558,
  activeClientsCount: 24,
  dataSavedMB: 1420.5,
  avgLatencyMs: 1.8,
  protectionStatus: 'active',
  filterLevel: 'high',
  pauseTimeRemainingSeconds: 0,
  uptimeSeconds: 86420,
};

export const MOCK_THREAT_LOGS: ThreatLogEntry[] = [
  {
    id: 'log-101',
    timestamp: '07:14:22',
    domain: 'telemetry.smart-tv.samsungcloud.com',
    clientIp: '192.168.1.140',
    clientName: 'Living Room Smart TV 75"',
    category: 'Telemetry',
    action: 'Blocked',
    severity: 'medium',
  },
  {
    id: 'log-102',
    timestamp: '07:14:18',
    domain: 'ads.doubleclick.net',
    clientIp: '192.168.1.112',
    clientName: 'Dennis-MacBook-Pro',
    category: 'Ad Tracker',
    action: 'Blocked',
    severity: 'low',
  },
  {
    id: 'log-103',
    timestamp: '07:14:02',
    domain: 'crypto-miner-pool.evilhost.cx',
    clientIp: '192.168.1.188',
    clientName: 'Guest-Android-Phone',
    category: 'Cryptojacking',
    action: 'Blocked',
    severity: 'high',
  },
  {
    id: 'log-104',
    timestamp: '07:13:45',
    domain: 'phishing-login.verify-bank-za.net',
    clientIp: '192.168.1.109',
    clientName: 'Office-Workstation-04',
    category: 'Phishing',
    action: 'Blocked',
    severity: 'high',
  },
  {
    id: 'log-105',
    timestamp: '07:13:20',
    domain: 'vortex.data.microsoft.com',
    clientIp: '192.168.1.109',
    clientName: 'Office-Workstation-04',
    category: 'Telemetry',
    action: 'Blocked',
    severity: 'medium',
  },
  {
    id: 'log-106',
    timestamp: '07:12:50',
    domain: 'api.ionity.today',
    clientIp: '192.168.1.105',
    clientName: 'Gate^Flame-Node-Primary',
    category: 'Ad Tracker',
    action: 'Whitelisted',
    severity: 'low',
  },
  {
    id: 'log-107',
    timestamp: '07:12:11',
    domain: 'gambling-spins-promo.top',
    clientIp: '192.168.1.133',
    clientName: 'Kid-Tablet-iPad',
    category: 'Adult / Gambling',
    action: 'Blocked',
    severity: 'high',
  },
];

export const MOCK_CLIENTS: ConnectedClient[] = [
  {
    ip: '192.168.1.105',
    mac: 'DC:A6:32:88:14:2F',
    hostname: 'Gate^Flame-Node-Primary',
    deviceType: 'Server',
    queriesToday: 1420,
    blockedToday: 0,
    lastActive: 'Just now',
  },
  {
    ip: '192.168.1.112',
    mac: '3C:06:30:E1:8B:92',
    hostname: 'Dennis-MacBook-Pro',
    deviceType: 'Laptop',
    queriesToday: 12450,
    blockedToday: 4890,
    lastActive: '1 min ago',
  },
  {
    ip: '192.168.1.140',
    mac: 'E4:E0:C5:11:00:AB',
    hostname: 'Living Room Smart TV 75"',
    deviceType: 'TV',
    queriesToday: 8900,
    blockedToday: 4120,
    lastActive: 'Just now',
  },
  {
    ip: '192.168.1.188',
    mac: '90:9A:4A:22:78:CD',
    hostname: 'Guest-Android-Phone',
    deviceType: 'Smartphone',
    queriesToday: 4300,
    blockedToday: 1850,
    lastActive: '3 mins ago',
  },
  {
    ip: '192.168.1.109',
    mac: '70:85:C2:55:99:3E',
    hostname: 'Office-Workstation-04',
    deviceType: 'Laptop',
    queriesToday: 9100,
    blockedToday: 3200,
    lastActive: 'Just now',
  },
  {
    ip: '192.168.1.133',
    mac: 'A4:C3:F0:88:12:6B',
    hostname: 'Kid-Tablet-iPad',
    deviceType: 'Smartphone',
    queriesToday: 2680,
    blockedToday: 337,
    lastActive: '12 mins ago',
  },
];

export const INITIAL_USER_ACCOUNT: IonityUserAccount = {
  email: 'dennis.ionity.world@gmail.com',
  companyName: 'Ionity Global Client Node',
  subscriptionPlan: 'Standard Managed',
  subscriptionActive: true,
  warrantyValidUntil: '2028-06-30',
  linkedDeviceMac: 'DC:A6:32:88:14:2F',
  deviceNickname: 'Gate^Flame Primary Node #008',
  apiKey: 'gf_live_ionity_986aed755_prod_key',
  syncStatus: 'synced',
  lastSyncTimestamp: '2026-07-25 07:14:35',
  appTheme: 'system',
};

// Official Scripts from ION-GF-DEP Specs
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
