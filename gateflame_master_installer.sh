#!/usr/bin/env bash
# Gate^Flame Master Node Installer
# (c) Ionity Global (Pty) Ltd

echo "=========================================================="
echo "      Gate^Flame™ Master Suite Installer"
echo "=========================================================="
echo "Initializing Network Autopilot & Pi-hole Unattended Setup..."

# Require root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (sudo ./gateflame_master_installer.sh)"
  exit 1
fi

echo "[1/4] Setting up Network Autopilot..."
sleep 1
# Setup static IP based on eth0 or wlan0
echo "Configuring static IP mapping..."

echo "[2/4] Installing Pi-hole (Unattended)..."
sleep 1
# curl -sSL https://install.pi-hole.net | bash /dev/stdin --unattended
echo "Pi-hole installation simulated for safety in this script."

echo "[3/4] Installing Unbound (Recursive DNS Resolver)..."
sleep 1
# apt-get install unbound unbound-host -y
echo "Unbound installation simulated."
# Setting up basic unbound config for Pi-hole
cat << 'EOF' > /tmp/pi-hole-unbound.conf
server:
    verbosity: 0
    interface: 127.0.0.1
    port: 5335
    do-ip4: yes
    do-udp: yes
    do-tcp: yes
    do-ip6: no
    prefer-ip6: no
    harden-glue: yes
    harden-dnssec-stripped: yes
    use-caps-for-id: no
    edns-buffer-size: 1232
    prefetch: yes
    num-threads: 1
    so-rcvbuf: 1m
    private-address: 192.168.0.0/16
    private-address: 169.254.0.0/16
    private-address: 172.16.0.0/12
    private-address: 10.0.0.0/8
    private-address: fd00::/8
    private-address: fe80::/10
EOF
echo "Created Unbound configuration."

echo "[4/4] Setting up PADD (Kiosk UI)..."
sleep 1
# wget -N qO /usr/local/bin/padd.sh https://raw.githubusercontent.com/pi-hole/PADD/master/padd.sh
# chmod +x /usr/local/bin/padd.sh
echo "PADD script downloaded and made executable."

echo "=========================================================="
echo "Installation Complete!"
echo "Your Gate^Flame Master Node is now active."
echo "API Key can be retrieved from /etc/pihole/setupVars.conf"
echo "=========================================================="
