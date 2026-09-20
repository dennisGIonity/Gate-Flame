import express from 'express';
import fs from 'fs';
import { exec } from 'child_process';

const router = express.Router();

// Configuration
const SURICATA_LOG_PATH = process.env.SURICATA_LOG_PATH || '/var/log/suricata/eve.json';
const FAIL2BAN_LOG_PATH = process.env.FAIL2BAN_LOG_PATH || '/var/log/fail2ban.log';

// Helper to efficiently read the last N lines of a file using partial reads
async function readLastLines(filePath, maxLines = 150) {
    try {
        if (!fs.existsSync(filePath)) return [];
        
        const stats = await fs.promises.stat(filePath);
        const fileSize = stats.size;
        if (fileSize === 0) return [];
        
        // Read up to 64KB from the end of the file to prevent loading huge logs into RAM
        const CHUNK_SIZE = Math.min(65536, fileSize);
        const buffer = Buffer.alloc(CHUNK_SIZE);
        
        const fd = await fs.promises.open(filePath, 'r');
        await fd.read(buffer, 0, CHUNK_SIZE, fileSize - CHUNK_SIZE);
        await fd.close();
        
        const content = buffer.toString('utf8');
        const lines = content.split('\n').filter(line => line.trim() !== '');
        return lines.slice(-maxLines);
    } catch (err) {
        console.error(`Error reading ${filePath}:`, err.message);
        return [];
    }
}

// 1. Get Unified Threat Events
router.get('/events', async (req, res) => {
    try {
        const events = [];

        // Parse Suricata DPI Logs (eve.json is NDJSON - Newline Delimited JSON)
        const suricataLines = await readLastLines(SURICATA_LOG_PATH, 100);
        for (const line of suricataLines) {
            try {
                const log = JSON.parse(line);
                if (log.event_type === 'alert') {
                    events.push({
                        id: `suricata-${log.flow_id || Date.now()}-${Math.random()}`,
                        source: 'Suricata DPI',
                        timestamp: log.timestamp,
                        severity: log.alert?.severity || 3, // 1 is high, 3 is low
                        description: log.alert?.signature || 'Unknown Deep Packet Inspection Alert',
                        src_ip: log.src_ip,
                        dest_ip: log.dest_ip,
                        protocol: log.proto
                    });
                }
            } catch (e) {
                // Ignore parsing errors for partial lines
            }
        }

        // Parse Fail2Ban Logs (Iptables bouncers / SSH tarpit)
        const fail2banLines = await readLastLines(FAIL2BAN_LOG_PATH, 100);
        for (let i = 0; i < fail2banLines.length; i++) {
            const line = fail2banLines[i];
            
            // Typical line: 2026-08-09 10:00:00,000 fail2ban.actions [1234]: NOTICE [sshd] Ban 192.168.1.100
            if (line.includes('Ban ') || line.includes('Found ')) {
                const parts = line.split(' ');
                
                // Extract IP using simple regex
                const ipMatch = line.match(/(\d{1,3}\.){3}\d{1,3}/);
                const ip = ipMatch ? ipMatch[0] : 'Unknown IP';
                
                let action = line.includes('Ban ') ? 'Banned' : 'Detected';
                
                // Extract jail name
                let jailMatch = line.match(/\[(.*?)\]/g);
                let jail = jailMatch && jailMatch.length > 1 ? jailMatch[1].replace(/[\[\]]/g, '') : 'unknown-jail';

                events.push({
                    id: `fail2ban-${i}-${Date.now()}`,
                    source: 'Fail2Ban Bouncer',
                    timestamp: new Date().toISOString(), // Use current time if strict parsing is complex
                    severity: action === 'Banned' ? 1 : 2, // High severity for outright bans
                    description: `Automated iptables engagement. ${action} IP on jail: ${jail}`,
                    src_ip: ip,
                    dest_ip: 'Localhost',
                    protocol: 'TCP'
                });
            }
        }

        // Sort unified events by timestamp descending (newest first)
        events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ success: true, events });
    } catch (error) {
        console.error('Error fetching security events:', error);
        res.status(500).json({ error: 'Failed to fetch unified security events' });
    }
});

// 2. Trigger Safe NMAP Port Scan against Internal IP
router.post('/scan', (req, res) => {
    const { targetIp } = req.body;

    // Strict validation to prevent command injection
    if (!targetIp || !/^(\d{1,3}\.){3}\d{1,3}$/.test(targetIp)) {
        return res.status(400).json({ error: 'Invalid or missing target IP address. Provide a valid IPv4 address.' });
    }

    // Run a basic safe nmap scan:
    // -T4: fast timing
    // -F: fast scan (top 100 ports)
    // -Pn: treat host as online (skip ping)
    const nmapCmd = `nmap -T4 -F -Pn ${targetIp}`;
    
    exec(nmapCmd, (error, stdout, stderr) => {
        if (error) {
            console.error('Nmap scan failed:', error.message);
            return res.status(500).json({ error: 'Nmap scan failed to execute. Ensure nmap is installed.' });
        }

        // Parse basic nmap plain text output into JSON
        const lines = stdout.split('\n');
        const openPorts = [];
        let macAddress = 'Unknown';

        for (const line of lines) {
            // Match port lines: "80/tcp open http"
            const portMatch = line.match(/^(\d+)\/([a-zA-Z]+)\s+open\s+(.*)$/);
            if (portMatch) {
                openPorts.push({
                    port: parseInt(portMatch[1]),
                    protocol: portMatch[2],
                    service: portMatch[3].trim()
                });
            }
            
            // Match MAC address: "MAC Address: 00:11:22:33:44:55 (Vendor Name)"
            const macMatches = line.match(/^MAC Address:\s+([0-9A-Fa-f:]+)\s+\((.*?)\)/);
            if (macMatches) {
                macAddress = macMatches[1];
            }
        }

        res.json({
            success: true,
            target: targetIp,
            macAddress,
            openPorts,
            rawOutput: stdout
        });
    });
});

export default router;
