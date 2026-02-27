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
  /**
   * True when Windows netsh portproxy rules exist for game ports (3000/2567).
   * These rules intercept LAN connections and redirect them to WSL2, breaking
   * Play Game.bat mode. Fix: run "Play Game.bat" as Administrator.
   */
  portproxyConflict?: boolean;
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
  /**
   * True when Windows netsh portproxy rules exist for game ports.
   * These rules intercept LAN connections and redirect them to WSL2, breaking
   * Play Game.bat mode. Fix: run "Play Game.bat" as Administrator.
   */
  portproxyConflict?: boolean;
}

export interface LANScanResult {
  found: LANServer[];
  subnets: string[];
  /** True when the scan ran inside WSL2 */
  isWSL2?: boolean;
  /** Windows host LAN IPs discovered during scan (populated when isWSL2 is true) */
  windowsAddresses?: string[];
}

export class LANClient {
  /** Map of (surface+port) combinations to their short codes */
  private shortCodeMap = new Map<string, string>();
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

  /**
   * Register a short code for LAN joins and return the short code URL.
   * The short code maps to surface and port, so the QR code stays simple.
   * Example: QR encodes http://192.168.1.100:3000/12345
   *          Server redirects /12345 to /?mode=network&surface=sphere
   */
  async registerShortCode(ip: string, surface: string, port: number, vitePort: number = 3000): Promise<string> {
    const code = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
    const codeStr = code.toString();
    const params: Record<string, string> = { surface: encodeURIComponent(surface) };
    if (port !== 2567) {
      params.port = port.toString();
    }

    try {
      const res = await fetch('/__lan/register-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeStr, params }),
      });
      if (res.ok) {
        const key = `${surface}:${port}`;
        this.shortCodeMap.set(key, codeStr);
        console.log(`[LAN] Registered short code ${codeStr} for ${surface} (port ${port})`);
        const shortUrl = `http://${ip}:${vitePort}/${codeStr}`;
        console.log(`[LAN] QR will encode: ${shortUrl}`);
        return shortUrl;
      } else {
        const errText = await res.text().catch(() => 'unknown error');
        console.warn(`[LAN] Short code registration failed: HTTP ${res.status}: ${errText}`);
      }
    } catch (err) {
      console.error('[LAN] Failed to register short code:', err);
    }
    // Fallback to full URL if registration fails (should not happen in normal operation)
    console.log('[LAN] Falling back to full join URL with parameters');
    return this.getJoinUrl(ip, port, surface, vitePort);
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
