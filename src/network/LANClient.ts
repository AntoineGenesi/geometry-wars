/**
 * Client-side API for LAN hosting, joining, and discovery.
 * Communicates with the Vite LAN plugin (/__lan/ endpoints).
 * Only works in dev mode (requires Vite dev server).
 */

export interface LANStatus {
  hosting: boolean;
  addresses: string[];
  port: number;
  /** True when the server is running inside WSL2 (affects reachability from LAN) */
  isWSL2?: boolean;
  /** Windows host LAN IPs (populated when isWSL2 is true) */
  windowsAddresses?: string[];
}

export interface LANRoom {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
  metadata: {
    surface?: string;
    status?: string;
    wave?: number;
  };
}

export interface LANServer {
  ip: string;
  port: number;
  info?: {
    game: string;
    self?: boolean;
  };
  rooms?: LANRoom[];
}

export interface LANStartResult {
  ok: boolean;
  addresses: string[];
  port: number;
  error?: string;
  /** True when the server is running inside WSL2 (addresses will be 172.x.x.x — unreachable from LAN) */
  isWSL2?: boolean;
  /** Windows host LAN IPs to use instead when isWSL2 is true (requires port forwarding via Setup-WSL-LAN.bat) */
  windowsAddresses?: string[];
}

export interface LANScanResult {
  found: LANServer[];
  subnets: string[];
}

export class LANClient {
  private available: boolean | null = null;

  /** Check if LAN APIs are available (dev mode only) */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const res = await fetch('/__lan/status');
      this.available = res.ok;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async getStatus(): Promise<LANStatus> {
    const res = await fetch('/__lan/status');
    if (!res.ok) throw new Error('LAN API unavailable');
    return res.json();
  }

  async startHost(options?: { shutdownTimeout?: number }): Promise<LANStartResult> {
    const body = options ? JSON.stringify(options) : undefined;
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch('/__lan/start', { method: 'POST', body, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try {
        const data = JSON.parse(text);
        return { ok: false, addresses: [], port: 0, error: data.error ?? `HTTP ${res.status}` };
      } catch {
        return { ok: false, addresses: [], port: 0, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
      }
    }
    return res.json();
  }

  async stopHost(): Promise<void> {
    await fetch('/__lan/stop', { method: 'POST' });
  }

  async scan(): Promise<LANScanResult> {
    const res = await fetch('/__lan/scan');
    if (!res.ok) throw new Error('Scan failed');
    return res.json();
  }

  /** Fetch room list from a specific server */
  async fetchRooms(ip: string, port: number): Promise<LANRoom[]> {
    try {
      const res = await fetch(`http://${ip}:${port}/api/rooms`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.rooms) ? data.rooms : [];
    } catch {
      return [];
    }
  }

  /** Build the WebSocket URL for connecting to a LAN server */
  getServerWsUrl(ip: string, port: number): string {
    return `ws://${ip}:${port}`;
  }

  /** Build the full join URL for sharing with other players */
  getJoinUrl(ip: string, port: number, surface: string, vitePort: number = 3000): string {
    // Server URL is auto-derived from hostname (ws://hostname:2567).
    // Only include port= when non-default to keep URLs clean and human-readable.
    const portSuffix = port !== 2567 ? `&port=${port}` : '';
    return `http://${ip}:${vitePort}/?mode=network&surface=${encodeURIComponent(surface)}${portSuffix}`;
  }

  /** Build a mobile-optimized join URL (includes ?mobile=true for phone-specific UI) */
  getMobileJoinUrl(ip: string, port: number, surface: string, vitePort: number = 3000): string {
    const portSuffix = port !== 2567 ? `&port=${port}` : '';
    return `http://${ip}:${vitePort}/?mobile=true&mode=network&surface=${encodeURIComponent(surface)}${portSuffix}`;
  }
}
