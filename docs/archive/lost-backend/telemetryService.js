import fs from 'fs';
import { exec } from 'child_process';
import axios from 'axios';
import os from 'os';

// Configuration
const TELEMETRY_INTERVAL_MS = 15000; // 15 seconds
const TEMP_THRESHOLD_C = 75;
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || 'http://localhost:3001/api/alerts';
const RESTART_COMMAND = process.env.NON_CRITICAL_RESTART_CMD || 'echo "Restarting non-critical services..."';

// State to hold the latest metrics for Prometheus scraping
let latestMetrics = {
    cpuUsagePercent: 0,
    memoryTotal: 0,
    memoryAvailable: 0,
    temperatureC: 0,
    diskReads: 0,
    diskWrites: 0
};

// Previous CPU state for calculating usage
let prevCpuState = { idle: 0, total: 0 };

// Parse /proc/stat to get CPU usage (Ultra-low overhead vs spawning top/ps)
async function getCpuUsage() {
    try {
        const stat = await fs.promises.readFile('/proc/stat', 'utf8');
        const lines = stat.split('\n');
        const cpuLine = lines[0]; // First line is total CPU
        const parts = cpuLine.match(/\d+/g).map(Number);
        
        // parts = [user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice]
        const idle = parts[3] + parts[4]; // idle + iowait
        const total = parts.reduce((acc, val) => acc + val, 0);

        const idleDiff = idle - prevCpuState.idle;
        const totalDiff = total - prevCpuState.total;
        
        prevCpuState = { idle, total };

        if (totalDiff === 0) return 0;
        
        const usage = 100 * (1 - idleDiff / totalDiff);
        return usage;
    } catch (err) {
        // Fallback for Windows or non-Linux testing environments
        const cpus = os.cpus();
        let idle = 0, total = 0;
        cpus.forEach(cpu => {
            for (let type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        });
        const usage = 100 * (1 - idle / total);
        return usage;
    }
}

// Parse /proc/meminfo
async function getMemoryStats() {
    try {
        const meminfo = await fs.promises.readFile('/proc/meminfo', 'utf8');
        const totalMatch = meminfo.match(/MemTotal:\s+(\d+) kB/);
        const availMatch = meminfo.match(/MemAvailable:\s+(\d+) kB/);
        
        return {
            total: totalMatch ? parseInt(totalMatch[1]) * 1024 : os.totalmem(),
            available: availMatch ? parseInt(availMatch[1]) * 1024 : os.freemem()
        };
    } catch (err) {
        return { total: os.totalmem(), available: os.freemem() };
    }
}

// Read thermal zone (Typical path for Raspberry Pi / Linux)
async function getTemperature() {
    try {
        const tempStr = await fs.promises.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        return parseInt(tempStr.trim()) / 1000; // millidegrees to degrees C
    } catch (err) {
        // Fallback dummy value if hardware thermal zone isn't available
        return 40.0; 
    }
}

// Basic Disk I/O from /proc/diskstats
async function getDiskIO() {
    try {
        const diskstats = await fs.promises.readFile('/proc/diskstats', 'utf8');
        const lines = diskstats.split('\n');
        let reads = 0;
        let writes = 0;
        // Simple heuristic: grab the stats for mmcblk0 (SD Card) or sda (SSD/HDD)
        for (const line of lines) {
            if (line.includes('mmcblk0 ') || line.includes('sda ')) {
                const parts = line.trim().split(/\s+/);
                // parts[3] = reads completed, parts[7] = writes completed 
                // Note: kernel versions can vary, these index the standard outputs
                if (parts.length >= 8) {
                    reads += parseInt(parts[3]);
                    writes += parseInt(parts[7]);
                }
            }
        }
        return { reads, writes };
    } catch (err) {
        return { reads: 0, writes: 0 };
    }
}

// Thermal Management Action
let isCoolingDown = false;
async function handleThermalManagement(tempC) {
    if (tempC > TEMP_THRESHOLD_C && !isCoolingDown) {
        console.warn(`[THERMAL ALERT] Temperature exceeded ${TEMP_THRESHOLD_C}°C! Current: ${tempC.toFixed(1)}°C`);
        isCoolingDown = true;

        // 1. Trigger Webhook Alert
        try {
            await axios.post(ALERT_WEBHOOK_URL, {
                alert: 'High Temperature',
                temperature: tempC,
                threshold: TEMP_THRESHOLD_C,
                timestamp: new Date().toISOString()
            });
            console.log('[THERMAL ALERT] Webhook sent successfully.');
        } catch (err) {
            console.error('[THERMAL ALERT] Failed to send webhook:', err.message);
        }

        // 2. Execute shell command to gracefully restart non-critical services
        exec(RESTART_COMMAND, (error, stdout, stderr) => {
            if (error) {
                console.error(`[THERMAL ALERT] Failed to execute mitigation command: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`[THERMAL ALERT] Mitigation command stderr: ${stderr}`);
            }
            console.log(`[THERMAL ALERT] Mitigation command executed. Output: ${stdout.trim()}`);
        });

        // Reset cooldown after 5 minutes to prevent spamming
        setTimeout(() => {
            isCoolingDown = false;
            console.log('[THERMAL ALERT] Cooldown period ended. Ready for new alerts.');
        }, 5 * 60 * 1000);
    }
}

// Main Polling Loop
async function pollTelemetry() {
    try {
        const [cpuUsagePercent, memStats, temperatureC, diskIO] = await Promise.all([
            getCpuUsage(),
            getMemoryStats(),
            getTemperature(),
            getDiskIO()
        ]);

        latestMetrics = {
            cpuUsagePercent,
            memoryTotal: memStats.total,
            memoryAvailable: memStats.available,
            temperatureC,
            diskReads: diskIO.reads,
            diskWrites: diskIO.writes
        };

        // Check thermal conditions
        await handleThermalManagement(temperatureC);

    } catch (err) {
        console.error('Error polling telemetry:', err);
    }
}

// Initialize the service
export function startTelemetryService() {
    pollTelemetry(); // Initial poll
    setInterval(pollTelemetry, TELEMETRY_INTERVAL_MS); // Schedule periodic polling
    console.log(`Telemetry service started. Polling every ${TELEMETRY_INTERVAL_MS / 1000}s`);
}

// Export Prometheus formatted metrics
export function getPrometheusMetrics() {
    return `
# HELP gateflame_cpu_usage_percent CPU usage percentage
# TYPE gateflame_cpu_usage_percent gauge
gateflame_cpu_usage_percent ${latestMetrics.cpuUsagePercent.toFixed(2)}

# HELP gateflame_memory_total_bytes Total available memory in bytes
# TYPE gateflame_memory_total_bytes gauge
gateflame_memory_total_bytes ${latestMetrics.memoryTotal}

# HELP gateflame_memory_available_bytes Currently available memory in bytes
# TYPE gateflame_memory_available_bytes gauge
gateflame_memory_available_bytes ${latestMetrics.memoryAvailable}

# HELP gateflame_temperature_celsius System temperature in degrees Celsius
# TYPE gateflame_temperature_celsius gauge
gateflame_temperature_celsius ${latestMetrics.temperatureC.toFixed(2)}

# HELP gateflame_disk_reads_total Total disk read operations completed
# TYPE gateflame_disk_reads_total counter
gateflame_disk_reads_total ${latestMetrics.diskReads}

# HELP gateflame_disk_writes_total Total disk write operations completed
# TYPE gateflame_disk_writes_total counter
gateflame_disk_writes_total ${latestMetrics.diskWrites}
`.trim() + '\\n';
}
