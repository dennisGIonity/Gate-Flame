import fs from 'fs';
import { exec } from 'child_process';
import axios from 'axios';
import mqtt from 'mqtt';
import speedTest from 'speedtest-net';

// Configuration from env
const DHCP_LEASES_FILE = process.env.DHCP_LEASES_FILE || '/etc/pihole/dhcp.leases';
const ARP_SCAN_CMD = process.env.ARP_SCAN_CMD || 'arp-scan --localnet';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC_ALERTS = process.env.MQTT_TOPIC_ALERTS || 'gateflame/alerts';
const SMTP_WEBHOOK_URL = process.env.SMTP_WEBHOOK_URL || 'http://localhost:3001/api/email';
const LATENCY_ALERT_THRESHOLD_MS = process.env.LATENCY_ALERT_THRESHOLD_MS || 100;

// Scan Intervals
const ARP_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DHCP_POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const WAN_AUDIT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// State
let knownMacAddresses = new Set();
let mqttClient = null;
let mqttErrorLogged = false;
let arpScanWarned = false;

// Initialize MQTT
function initMQTT() {
    mqttClient = mqtt.connect(MQTT_BROKER_URL, { reconnectPeriod: 10000 }); // Retry every 10s
    mqttClient.on('connect', () => {
        mqttErrorLogged = false;
        console.log(`[NETWORK SCANNER] Connected to MQTT broker at ${MQTT_BROKER_URL}`);
    });
    mqttClient.on('error', (err) => {
        if (!mqttErrorLogged) {
            console.warn(`[NETWORK SCANNER] MQTT Connection error (Broker likely offline, retrying silently in background): ${err.message}`);
            mqttErrorLogged = true;
        }
    });
}

// Alerting Function
async function triggerAlert(title, message, data = {}) {
    console.warn(`[ALERT] ${title}: ${message}`);
    
    const payload = { title, message, timestamp: new Date().toISOString(), ...data };
    
    // 1. Publish to MQTT
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(MQTT_TOPIC_ALERTS, JSON.stringify(payload));
    }

    // 2. Send via SMTP Webhook
    try {
        await axios.post(SMTP_WEBHOOK_URL, payload);
        console.log(`[NETWORK SCANNER] SMTP Webhook alert sent for: ${title}`);
    } catch (err) {
        // Will fail silently if the webhook isn't configured, which is fine
        console.error(`[NETWORK SCANNER] Failed to send SMTP webhook for alert:`, err.message);
    }
}

// Check for new MAC addresses and alert if Rogue
function processMacAddress(mac, ip, source) {
    if (!mac || mac.length < 17) return; // Basic validation
    mac = mac.toLowerCase();
    
    // Check if new/rogue
    if (!knownMacAddresses.has(mac) && knownMacAddresses.size > 0) {
        // Only alert if we already have an established baseline (size > 0). 
        // We don't want to alert on the first scan when everything is "new".
        triggerAlert('Rogue Device Detected', `New MAC address found via ${source}.`, { mac, ip, source });
    }
    
    knownMacAddresses.add(mac);
}

// Passive Discovery: Pi-hole / dnsmasq leases
async function pollDhcpLeases() {
    try {
        if (!fs.existsSync(DHCP_LEASES_FILE)) return;
        const leases = await fs.promises.readFile(DHCP_LEASES_FILE, 'utf8');
        const lines = leases.split('\n');
        
        for (const line of lines) {
            if (!line.trim()) continue;
            // Format: timestamp mac ip hostname client-id
            const parts = line.split(' ');
            if (parts.length >= 3) {
                const mac = parts[1];
                const ip = parts[2];
                processMacAddress(mac, ip, 'DHCP Lease');
            }
        }
    } catch (error) {
        console.error('[NETWORK SCANNER] Error reading DHCP leases:', error.message);
    }
}

// Active Discovery: ARP Scan
function activeArpScan() {
    exec(ARP_SCAN_CMD, (error, stdout, stderr) => {
        if (error) {
            if (!arpScanWarned) {
                console.warn(`[NETWORK SCANNER] ARP scan skipped. (Is arp-scan installed? Ignore if on Windows dev environment): ${error.message.split('\n')[0]}`);
                arpScanWarned = true;
            }
            return;
        }
        arpScanWarned = false;
        
        const lines = stdout.split('\n');
        // Typical arp-scan output lines: "192.168.1.5   00:11:22:33:44:55   Vendor Name"
        for (const line of lines) {
            // Regex to find MAC addresses
            const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
            if (macMatch) {
                const mac = macMatch[0];
                const ipMatch = line.match(/(\d{1,3}\.){3}\d{1,3}/);
                const ip = ipMatch ? ipMatch[0] : 'Unknown';
                processMacAddress(mac, ip, 'ARP Scan');
            }
        }
    });
}

// WAN Auditing: Speedtest and Latency
async function runWanAudit() {
    console.log('[NETWORK SCANNER] Starting scheduled WAN Audit (Speedtest)...');
    try {
        const result = await speedTest({ acceptLicense: true, acceptGdpr: true });
        
        // speedtest-net returns bandwidth in bytes per second, divide by 125000 to get Mbps
        const downloadSpeedMbps = result.download.bandwidth / 125000;
        const uploadSpeedMbps = result.upload.bandwidth / 125000;
        const latency = result.ping.latency;
        const jitter = result.ping.jitter;

        console.log(`[NETWORK SCANNER] WAN Audit Complete. DL: ${downloadSpeedMbps.toFixed(2)} Mbps, UL: ${uploadSpeedMbps.toFixed(2)} Mbps, Latency: ${latency}ms`);

        if (latency > LATENCY_ALERT_THRESHOLD_MS) {
            triggerAlert('WAN Latency Spike', `Latency is abnormally high: ${latency}ms`, {
                latency,
                jitter,
                downloadSpeedMbps,
                uploadSpeedMbps
            });
        }
    } catch (error) {
        console.error('[NETWORK SCANNER] WAN Audit Speedtest failed:', error.message);
    }
}

// Initialize Service
export function startNetworkScanner() {
    console.log('[NETWORK SCANNER] Initializing Network Discovery and Auditing Service...');
    
    initMQTT();

    // Do initial scans to build a baseline of known devices
    pollDhcpLeases();
    activeArpScan();
    
    // First WAN audit
    runWanAudit();

    // Schedule intervals
    setInterval(pollDhcpLeases, DHCP_POLL_INTERVAL_MS);
    setInterval(activeArpScan, ARP_SCAN_INTERVAL_MS);
    setInterval(runWanAudit, WAN_AUDIT_INTERVAL_MS);
}
