import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ping from 'ping';
import { startTelemetryService, getPrometheusMetrics } from './telemetryService.js';
import { startNetworkScanner } from './networkScanner.js';
import securityAPI from './securityAPI.js';
import { startContainers, stopContainers, checkContainerHealth } from './containerManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
// You will need to provide your Pi-hole IP and Web Password (API token) in your environment
const PIHOLE_URL = process.env.PIHOLE_URL || 'http://pi.hole';
const PIHOLE_TOKEN = process.env.PIHOLE_TOKEN || 'YOUR_PIHOLE_API_TOKEN_HERE';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

app.use(cors());
app.use(express.json());

// Mount the Security API Router
app.use('/api/security', securityAPI);

// Start the low-overhead telemetry service
startTelemetryService();

// Start the network scanner service
startNetworkScanner();

// --- 0. Telemetry & Metrics ---
app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(getPrometheusMetrics());
});

// --- 1. Pi-hole Integration ---

// Fetch live metrics
app.get('/api/pihole/metrics', async (req, res) => {
    try {
        const response = await axios.get(`${PIHOLE_URL}/admin/api.php?summaryRaw`);
        res.json({
            dns_queries_today: response.data.dns_queries_today,
            ads_blocked_today: response.data.ads_blocked_today,
            ads_percentage_today: response.data.ads_percentage_today,
            domains_being_blocked: response.data.domains_being_blocked,
            status: response.data.status
        });
    } catch (error) {
        console.error('Error fetching Pi-hole metrics:', error.message);
        res.status(500).json({ error: 'Failed to fetch Pi-hole metrics' });
    }
});

// Toggle Pi-hole status (enable/disable)
app.post('/api/pihole/toggle', async (req, res) => {
    const { action, seconds } = req.body; 
    // action: 'enable' or 'disable'
    // seconds: optional, how long to disable (for disable action)
    
    if (!PIHOLE_TOKEN || PIHOLE_TOKEN === 'YOUR_PIHOLE_API_TOKEN_HERE') {
        return res.status(400).json({ error: 'Pi-hole API token is not configured.' });
    }

    try {
        let endpoint = `${PIHOLE_URL}/admin/api.php?${action}&auth=${PIHOLE_TOKEN}`;
        if (action === 'disable' && seconds) {
            endpoint = `${PIHOLE_URL}/admin/api.php?disable=${seconds}&auth=${PIHOLE_TOKEN}`;
        }
        
        const response = await axios.get(endpoint);
        res.json({ success: true, status: response.data.status });
    } catch (error) {
        console.error('Error toggling Pi-hole:', error.message);
        res.status(500).json({ error: 'Failed to toggle Pi-hole' });
    }
});

// --- 2. Network Ping/Latency ---
app.get('/api/network/ping', async (req, res) => {
    const host = req.query.host || '8.8.8.8';
    try {
        const result = await ping.promise.probe(host);
        res.json({
            host: host,
            alive: result.alive,
            time: result.time, // Latency in ms
            packetLoss: result.packetLoss
        });
    } catch (error) {
        console.error('Error pinging host:', error.message);
        res.status(500).json({ error: 'Failed to ping host' });
    }
});

// --- 3. Settings State ---

// Helper function to read settings
const readSettings = () => {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return {
            stealthMode: false,
            activeModules: ['pihole', 'firewall'],
            theme: 'dark'
        }; // Default settings
    }
    const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return JSON.parse(data);
};

// Get settings
app.get('/api/settings', (req, res) => {
    try {
        const settings = readSettings();
        res.json(settings);
    } catch (error) {
        console.error('Error reading settings:', error.message);
        res.status(500).json({ error: 'Failed to read settings' });
    }
});

// Update settings
app.post('/api/settings', (req, res) => {
    try {
        const currentSettings = readSettings();
        const newSettings = { ...currentSettings, ...req.body };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2), 'utf8');
        res.json({ success: true, settings: newSettings });
    } catch (error) {
        console.error('Error writing settings:', error.message);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// --- 4. Service Orchestration ---
app.post('/api/v1/services/:serviceId', async (req, res) => {
    const { serviceId } = req.params;
    const { action } = req.body; // 'start' or 'stop'
    
    try {
        console.log(`[API] Service toggle request: ${serviceId} -> ${action}`);
        
        // Special cases for container orchestration modules
        if (serviceId === 'zero-trust' || serviceId === 'orchestrator') {
            if (action === 'start') {
                const success = await startContainers();
                if (!success) return res.status(500).json({ error: 'Failed to start containers' });
            } else {
                const success = await stopContainers();
                if (!success) return res.status(500).json({ error: 'Failed to stop containers' });
            }
        }
        
        res.json({ success: true, service: serviceId, state: action });
    } catch (error) {
        console.error('Error toggling service:', error.message);
        res.status(500).json({ error: 'Failed to toggle service' });
    }
});

app.get('/api/v1/orchestration/health', async (req, res) => {
    try {
        const report = await checkContainerHealth();
        res.json({ success: true, health: report });
    } catch (error) {
        console.error('Error fetching container health:', error.message);
        res.status(500).json({ error: 'Failed to fetch container health' });
    }
});

// Basic health check route
app.get('/', (req, res) => {
    res.json({ status: 'Gate^Flame Network Security Node Backend is running.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
    console.log(`Gate^Flame Backend Server running on http://localhost:${PORT}`);
});
