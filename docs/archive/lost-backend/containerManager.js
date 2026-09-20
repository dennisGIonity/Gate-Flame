import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// Exact service names as defined in docker-compose.yml
const TARGET_SERVICES = [
    'gateflame-backend', 
    'gateflame-suricata', 
    'gateflame-prometheus'
];

/**
 * Executes a Docker command safely using child_process
 */
async function runDockerCommand(command) {
    try {
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            console.warn(`[DOCKER WARN] ${stderr.trim()}`);
        }
        return { success: true, output: stdout.trim() };
    } catch (error) {
        console.error(`[DOCKER ERROR] Command failed: ${command}`);
        console.error(`[DOCKER ERROR] Details: ${error.message}`);
        return { success: false, output: null, error: error.message };
    }
}

/**
 * Starts all Zero-Trust segregated containers via docker-compose
 */
export async function startContainers() {
    console.log('[CONTAINER MANAGER] Spinning up segregated containers...');
    // We use -d for detached mode to run in background
    const result = await runDockerCommand('docker compose up -d');
    
    if (result.success) {
        console.log('[CONTAINER MANAGER] Successfully started the environment.');
        await checkContainerHealth();
    } else {
        console.error('[CONTAINER MANAGER] Failed to start containers. See logs above.');
    }
    return result.success;
}

/**
 * Safely spins down all running containers
 */
export async function stopContainers() {
    console.log('[CONTAINER MANAGER] Gracefully spinning down all containers...');
    const result = await runDockerCommand('docker compose down');
    
    if (result.success) {
        console.log('[CONTAINER MANAGER] Environment safely spun down.');
    } else {
        console.error('[CONTAINER MANAGER] Failed to stop environment cleanly.');
    }
    return result.success;
}

/**
 * Audits the health and uptime of the deployed containers
 */
export async function checkContainerHealth() {
    console.log('[CONTAINER MANAGER] Auditing container health and uptime statuses...');
    
    // Utilize the Docker CLI json formatter for robust parsing
    const result = await runDockerCommand('docker ps -a --format "{{json .}}"');
    
    if (!result.success || !result.output) {
        console.error('[CONTAINER MANAGER] Could not fetch container health metrics.');
        return [];
    }

    try {
        // Parse the NDJSON output from docker ps
        const lines = result.output.split('\n').filter(line => line.trim() !== '');
        const allContainers = lines.map(line => JSON.parse(line));
        
        // Map over our strict target list to verify exactly what should be running
        const healthReport = TARGET_SERVICES.map(serviceName => {
            const container = allContainers.find(c => c.Names === serviceName);
            return {
                service: serviceName,
                status: container ? container.State : 'Missing',
                uptime: container ? container.Status : 'N/A',
                image: container ? container.Image : 'N/A'
            };
        });

        // Print a nice table to the console for the administrator
        console.table(healthReport);
        
        return healthReport;
    } catch (error) {
        console.error(`[CONTAINER MANAGER] Error parsing Docker output:`, error.message);
        return [];
    }
}

// ---------------------------------------------------------
// CLI Execution Handler (If run directly via node containerManager.js)
// ---------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('containerManager.js')) {
    const action = process.argv[2];

    switch (action) {
        case 'start':
            startContainers();
            break;
        case 'stop':
            stopContainers();
            break;
        case 'health':
        case 'status':
            checkContainerHealth();
            break;
        default:
            console.log(`
Gate^Flame Container Orchestrator
Usage: node containerManager.js [start|stop|health]
            `);
            break;
    }
}
