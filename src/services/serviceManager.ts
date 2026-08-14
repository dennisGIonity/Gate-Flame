import { gateflameApi } from './gateflameApi';
import { ApiRequestError } from './apiClient';
import type { ModuleStatus } from '../types/api';

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

export interface ToggleResult {
  ok: boolean;
  status: ModuleStatus;
  /** Set when the node acted in name only, or when the result is simulated. */
  advisory?: string;
  /** Set when the node refused — e.g. stopping without kiosk scope. */
  error?: string;
}

export const ApiService = {
  /**
   * Start or stop a security module on the node.
   *
   * This used to be `setTimeout(800); return true`, with the real fetch
   * commented out. It always reported success, so every switch in the product
   * turned green whether or not anything existed to turn on.
   *
   * It now goes through `gateflameApi`, which either reaches real hardware or
   * routes to the simulator and marks the result as simulated. Callers must
   * surface `advisory` rather than treating `ok` as the whole story: a firewall
   * bounce recorded with no packet-filter control is a success *and* a caveat.
   */
  toggleService: async (
    moduleId: string,
    endpoint: string,
    enable: boolean,
  ): Promise<ToggleResult> => {
    const slug = endpoint.split('/').filter(Boolean).pop() ?? moduleId;

    try {
      const result = await gateflameApi.toggleService(moduleId, slug, enable);
      const advisory =
        result.advisory ??
        (result.gap ? `${result.gap}${result.remedy ? ` — ${result.remedy}` : ''}` : undefined);

      return {
        ok: result.status === 'running' || result.status === 'stopped' || result.status === 'degraded',
        status: result.status,
        advisory,
      };
    } catch (error) {
      const message =
        error instanceof ApiRequestError || error instanceof Error
          ? error.message
          : 'Unknown error';

      // A refusal is information, not a glitch. Stopping a module requires
      // kiosk scope by design, so a phone receives a 403 here and the user has
      // to be told why rather than shown a toggle that silently snaps back.
      console.error(`[gateflame] ${enable ? 'start' : 'stop'} ${slug} failed:`, message);
      return { ok: false, status: 'failed', error: message };
    }
  },
};
