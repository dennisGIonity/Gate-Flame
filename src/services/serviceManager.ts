export interface ModuleConfig {
  id: string;
  title: string;
  description: string;
  apiEndpoint: string;
}

export const SECURITY_MODULES: ModuleConfig[] = [
  {
    id: 'module_network_scan',
    title: 'Multi-Vector Network Scanning & Intrusion Detection',
    description: 'Active ARP sweeps, DNS lookup scans, and active Nmap port scanning. Integrates SIEM log analysis and real-time packet-level intrusion detection.',
    apiEndpoint: '/api/v1/services/net-scan'
  },
  {
    id: 'module_firewall_bounce',
    title: 'Collaborative Threat Intelligence & Firewall Bouncing',
    description: 'Leverages shared cyber threat intelligence to detect drive-by port scanning. Deploys automated iptables/nftables bouncers and SSH tarpits.',
    apiEndpoint: '/api/v1/services/firewall-bounce'
  },
  {
    id: 'module_dpi_flow',
    title: 'Deep Packet Inspection (DPI) & Flow Analysis',
    description: 'Real-time protocol categorization, high-bandwidth user flagging, and CVE vulnerability scanning with jemalloc/tcmalloc memory optimization.',
    apiEndpoint: '/api/v1/services/dpi-flow'
  },
  {
    id: 'module_telemetry',
    title: 'High-Frequency Telemetry & Resource Monitoring',
    description: 'Per-second cgroup filesystem data collection (CPU, RAM, Disk I/O) across the host and active Docker containers with 1-3% CPU overhead.',
    apiEndpoint: '/api/v1/services/telemetry'
  },
  {
    id: 'module_tsdb_viz',
    title: 'Time-Series Database Storage & Visualization',
    description: '15-second interval pull-model telemetry scraping to a time-series database for interactive dashboard rendering of core loads and thermals.',
    apiEndpoint: '/api/v1/services/tsdb'
  },
  {
    id: 'module_orchestration',
    title: 'Automated Service Orchestration & Thermal Management',
    description: 'Automated service restarting and thermal throttling prevention (e.g., alerts at >75°C) based on predefined operational rules.',
    apiEndpoint: '/api/v1/services/orchestrator'
  },
  {
    id: 'module_wan_audit',
    title: 'WAN Performance Tracking & Auditing',
    description: 'Scheduled bandwidth evaluations logging download/upload speeds, latency, and jitter, throttled to prevent metered data depletion.',
    apiEndpoint: '/api/v1/services/wan-audit'
  },
  {
    id: 'module_zero_trust',
    title: 'Zero-Trust Container Segregation',
    description: 'Read-only root filesystems, minimized privileges, and noexec tmpfs memory mapping to prevent arbitrary execution and DoS exhaustion.',
    apiEndpoint: '/api/v1/services/zero-trust'
  },
  {
    id: 'module_passive_discovery',
    title: 'Passive Network Discovery & Notification Routing',
    description: 'Low-overhead (~100MB) subnet monitoring importing dnsmasq/Pi-hole leases. Triggers MQTT, Webhook, and email alerts for rogue devices.',
    apiEndpoint: '/api/v1/services/discovery'
  }
];

export const ApiService = {
  /**
   * Physically engages or disengages a backend security module
   */
  toggleService: async (moduleId: string, endpoint: string, enable: boolean): Promise<boolean> => {
    try {
      console.log(`[API CALL] Engaging hardware API: POST ${endpoint} -> State: ${enable ? 'ON' : 'OFF'}`);
      
      // MOCK API CALL: Replace this block with your actual fetch request
      // const response = await fetch(endpoint, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      //   body: JSON.stringify({ action: enable ? 'start' : 'stop' })
      // });
      // if (!response.ok) throw new Error('Hardware API rejected request');
      
      // Simulating network/hardware spin-up delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      return true; // Success
    } catch (error) {
      console.error(`[API ERROR] Failed to engage module ${moduleId}:`, error);
      return false; // Failed
    }
  }
};
