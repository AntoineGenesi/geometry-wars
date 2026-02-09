/**
 * Client-side API for LAN hosting, joining, and discovery.
 * Communicates with the Vite LAN plugin (/__lan/ endpoints).
 * Only works in dev mode (requires Vite dev server).
 */

export interface LANStatus {
  hosting: boolean;
  addresses: string[];
  port: number;
}

export interface LANServer {
  ip: string;
  port: number;
  info?: {
    game: string;
    self?: boolean;
  };
}

export interface LANStartResult {
  ok: boolean;
  addresses: string[];
  port: number;
  error?: string;
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

  async startHost(): Promise<LANStartResult> {
    const res = await fetch('/__lan/start', { method: 'POST' });
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

  /** Build the WebSocket URL for connecting to a LAN server */
  getServerWsUrl(ip: string, port: number): string {
    return `ws://${ip}:${port}`;
  }

  /** Build the full join URL for sharing with other players */
  getJoinUrl(ip: string, port: number, surface: string, vitePort: number = 3000): string {
    return `http://${ip}:${vitePort}?mode=network&surface=${surface}&server=ws://${ip}:${port}`;
  }
}
