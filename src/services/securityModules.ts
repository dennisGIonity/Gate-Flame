/**
 * Gate^Flame — the security-module catalogue.
 *
 * A LEAF module: it imports nothing from this project, by design.
 *
 * This lived in serviceManager.ts until 2026-08-18, which created a genuine
 * import cycle:
 *
 *   gateflameApi → mockAdapter → serviceManager → gateflameApi
 *
 * serviceManager needs gateflameApi to actually call the node; mockAdapter
 * needed serviceManager only for this list. mockAdapter reads the list at
 * MODULE-EVALUATION time (it builds `simulatedModules` as a top-level const),
 * so whichever module the bundler happened to evaluate first decided whether
 * SECURITY_MODULES existed yet. Evaluate serviceManager first and mockAdapter
 * saw an uninitialised binding:
 *
 *   Uncaught ReferenceError: Cannot access 'je' before initialization
 *
 * That is what the mobile APK threw on a real handset, after painting. The
 * cycle had been latent for two commits; adding a manualChunks vendor split
 * changed the evaluation order and made it fatal — the bug was the cycle, not
 * the split.
 *
 * Keeping this list in a module with no project imports means the cycle cannot
 * be reintroduced by editing either side of it. src/services/importCycles.test.ts
 * fails the build if any cycle appears anywhere in src/.
 */

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

/** `/api/v1/services/net-scan` → `net-scan`. */
export const slugFor = (moduleConfig: ModuleConfig): string =>
  moduleConfig.apiEndpoint.split('/').filter(Boolean).pop() ?? moduleConfig.id;
