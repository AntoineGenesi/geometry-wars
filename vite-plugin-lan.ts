import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { networkInterfaces } from 'os';
import { readFileSync } from 'fs';
import http from 'http';
import path from 'path';

const SERVER_PORT = 2567;

/** Check if running inside WSL2 */
function detectWSL2(): boolean {
  try {
    const version = readFileSync('/proc/version', 'utf8').toLowerCase();
    return version.includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * Get Windows host LAN IPs when running inside WSL2.
 * Uses powershell.exe (available from WSL2) to query Windows network adapters.
 * Returns empty array if not in WSL2 or powershell unavailable.
 */
function getWindowsLANIPs(): string[] {
  try {
    const out = execSync(
      'powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch \'WSL|Loopback|vEthernet\' -and $_.PrefixOrigin -ne \'WellKnown\' }).IPAddress"',
      { timeout: 4000, encoding: 'utf8' }
    );
    return out
      .trim()
      .split(/\r?\n/)
      .map((ip: string) => ip.trim())
      .filter((ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== '127.0.0.1');
  } catch {
    return [];
  }
}

function getLANAddresses(): string[] {
  const interfaces = networkInterfaces();
  const lanAddresses: string[] = [];
  const virtualAddresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      // WSL2 creates a Hyper-V virtual switch with 172.x.x.x IPs.
      // These are NOT reachable from other devices on the LAN.
      // Separate them so real LAN IPs (192.168.x, 10.x) come first.
      const isVirtual = name.toLowerCase().includes('vethernet')
        || name.toLowerCase().includes('wsl')
        || name.toLowerCase().includes('hyper-v')
        || (iface.address.startsWith('172.') && !iface.address.startsWith('172.16.'));
      if (isVirtual) {
        virtualAddresses.push(iface.address);
      } else {
        lanAddresses.push(iface.address);
      }
    }
  }
  // Real LAN IPs first, virtual IPs last (so UI shows the right one prominently)
  return [...lanAddresses, ...virtualAddresses];
}

function getSubnet(ip: string): string {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export default function lanPlugin(): Plugin {
  let serverProcess: ChildProcess | null = null;
  let serverReady = false;

  async function checkServerHealth(): Promise<boolean> {
    try {
      await fetchWithTimeout(`http://localhost:${SERVER_PORT}/health`, 500);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deep health check: verifies the server can actually handle game operations,
   * not just respond to /health. A stale/zombie server may respond to /health
   * but fail on matchmake, causing ERR_EMPTY_RESPONSE for clients.
   */
  async function checkServerDeep(): Promise<boolean> {
    try {
      // Check both health AND rooms endpoint (rooms requires Colyseus matchMaker)
      await fetchWithTimeout(`http://localhost:${SERVER_PORT}/health`, 500);
      const roomsData = await fetchWithTimeout(`http://localhost:${SERVER_PORT}/api/rooms`, 1000);
      const parsed = JSON.parse(roomsData);
      // If we can parse rooms, the server's matchMaker is functional
      return Array.isArray(parsed.rooms) || parsed.note !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Kill any process listening on the server port. Used to clean up stale
   * servers from previous sessions that might respond to /health but fail
   * on actual game connections (ERR_EMPTY_RESPONSE).
   */
  function killStaleServer(): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (process.platform === 'win32') {
          // Windows: find PID on port, then kill it
          const out = execSync(`netstat -ano | findstr ":${SERVER_PORT}" | findstr "LISTENING"`, { timeout: 3000, encoding: 'utf8' });
          const pids = [...new Set(out.trim().split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
          for (const pid of pids) {
            try { execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 }); } catch { /* ignore */ }
          }
        } else {
          execSync(`fuser -k ${SERVER_PORT}/tcp 2>/dev/null`, { timeout: 3000 });
        }
      } catch {
        // Ignore errors — no process on port, or command not available
      }
      setTimeout(resolve, 500);
    });
  }

  async function handleStart(options?: { shutdownTimeout?: number }): Promise<{ ok: boolean; addresses: string[]; port: number; error?: string; isWSL2?: boolean; windowsAddresses?: string[] }> {
    const addresses = getLANAddresses();
    const wsl2 = detectWSL2();
    const windowsAddresses = wsl2 ? getWindowsLANIPs() : [];

    // Already hosting (we spawned this process ourselves)
    if (serverProcess && serverReady) {
      // Verify our own server is still healthy
      if (await checkServerHealth()) {
        return { ok: true, addresses, port: SERVER_PORT, isWSL2: wsl2, windowsAddresses };
      }
      // Our server died, clean up
      serverProcess.kill();
      serverProcess = null;
      serverReady = false;
    }

    // External server already running — do a DEEP check to ensure it can
    // actually handle game connections, not just respond to /health.
    // Stale servers from previous sessions often pass /health but fail on
    // matchmake, causing ERR_EMPTY_RESPONSE for clients.
    if (await checkServerDeep()) {
      serverReady = true;
      return { ok: true, addresses, port: SERVER_PORT, isWSL2: wsl2, windowsAddresses };
    }

    // If something is on the port but failed deep check, kill it
    if (await checkServerHealth()) {
      console.log('[LAN] Stale server detected on port ' + SERVER_PORT + ', killing...');
      await killStaleServer();
    }

    // Start the Colyseus server as child process
    // Use process.execPath (node) + tsx module for cross-platform compatibility.
    // spawn('tsx', ...) fails on Windows with ENOENT because .bin shims need .cmd extension.
    const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const shutdownTimeout = options?.shutdownTimeout ?? 180;
    const env = {
      ...process.env,
      PORT: String(SERVER_PORT),
      SHUTDOWN_TIMEOUT: String(shutdownTimeout),
    };

    serverProcess = spawn(process.execPath, [tsxPath, 'server/index.ts'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe',
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg.includes('Server running') || msg.includes('listening')) {
        serverReady = true;
      }
      console.log('[LAN Server]', msg);
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[LAN Server]', data.toString().trim());
    });

    serverProcess.on('exit', (code) => {
      console.log(`[LAN Server] Exited with code ${code}`);
      serverProcess = null;
      serverReady = false;
    });

    // Poll until ready (max 15 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await checkServerHealth()) {
        serverReady = true;
        console.log('[LAN] Server ready! LAN clients can connect at:');
        for (const addr of addresses) {
          console.log(`[LAN]   Game:   http://${addr}:3000`);
          console.log(`[LAN]   Server: ws://${addr}:${SERVER_PORT}`);
        }
        if (addresses.length === 0) {
          console.log('[LAN]   WARNING: No LAN addresses detected.');
        }
        return { ok: true, addresses, port: SERVER_PORT, isWSL2: wsl2, windowsAddresses };
      }
    }

    // Failed - cleanup
    serverProcess?.kill();
    serverProcess = null;
    return { ok: false, addresses, port: SERVER_PORT, error: 'Server failed to start within 15s', isWSL2: wsl2, windowsAddresses };
  }

  async function handleStop(): Promise<{ ok: boolean }> {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    // Also kill any external server on the port (e.g. started by Play Game.bat)
    await killStaleServer();
    serverReady = false;
    return { ok: true };
  }

  interface ScanRoom {
    roomId: string;
    name: string;
    clients: number;
    maxClients: number;
    metadata: Record<string, unknown>;
  }

  interface ScanServer {
    ip: string;
    port: number;
    info?: unknown;
    rooms?: ScanRoom[];
  }

  async function fetchRooms(ip: string, port: number): Promise<ScanRoom[]> {
    try {
      const data = await fetchWithTimeout(`http://${ip}:${port}/api/rooms`, 600);
      const parsed = JSON.parse(data);
      return Array.isArray(parsed.rooms) ? parsed.rooms : [];
    } catch {
      return [];
    }
  }

  async function handleScan(): Promise<{ found: ScanServer[]; subnets: string[] }> {
    const addresses = getLANAddresses();
    const subnets = [...new Set(addresses.map(getSubnet))];
    const found: ScanServer[] = [];

    // Check if ANY server is running on the game port (ours or external like Play Game.bat)
    const localServerAlive = await checkServerHealth();
    if (localServerAlive) {
      serverReady = true; // Mark as ready so stop button works
      const selfRooms = await fetchRooms('localhost', SERVER_PORT);
      // Pick the most likely LAN IP: prefer 192.168.x.x, then any non-172.x, then first available
      const primaryIp = addresses.find(a => a.startsWith('192.168.'))
        ?? addresses.find(a => !a.startsWith('172.'))
        ?? addresses[0]
        ?? 'localhost';
      found.push({ ip: primaryIp, port: SERVER_PORT, info: { game: 'geometry-wars-3d', self: true }, rooms: selfRooms });
    }

    // Scan each subnet
    const scanPromises: Promise<void>[] = [];
    for (const subnet of subnets) {
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        if (addresses.includes(ip)) continue; // Skip self
        scanPromises.push(
          fetchWithTimeout(`http://${ip}:${SERVER_PORT}/api/info`, 400)
            .then(async (data) => {
              try {
                const info = JSON.parse(data);
                if (info.game === 'geometry-wars-3d') {
                  const rooms = await fetchRooms(ip, SERVER_PORT);
                  found.push({ ip, port: SERVER_PORT, info, rooms });
                }
              } catch {
                /* ignore parse errors */
              }
            })
            .catch(() => {
              /* ignore timeouts/unreachable */
            }),
        );
      }
    }

    await Promise.allSettled(scanPromises);
    return { found, subnets };
  }

  return {
    name: 'geometry-wars-lan',

    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (!url.startsWith('/__lan/')) {
          return next();
        }

        const route = url.replace('/__lan/', '');

        if (route === 'status' && req.method === 'GET') {
          const wsl2 = detectWSL2();
          sendJson(res, {
            hosting: serverProcess !== null && serverReady,
            addresses: getLANAddresses(),
            port: SERVER_PORT,
            isWSL2: wsl2,
            windowsAddresses: wsl2 ? getWindowsLANIPs() : [],
          });
          return;
        }

        if (route === 'start' && req.method === 'POST') {
          // Parse optional JSON body for shutdown timeout
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk; });
          req.on('end', () => {
            let options: { shutdownTimeout?: number } | undefined;
            if (body) {
              try { options = JSON.parse(body); } catch { /* ignore */ }
            }
            handleStart(options)
              .then((data) => sendJson(res, data, data.ok ? 200 : 500))
              .catch((err) => sendJson(res, { ok: false, error: (err as Error).message }, 500));
          });
          return;
        }

        if (route === 'stop' && req.method === 'POST') {
          handleStop()
            .then((data) => sendJson(res, data))
            .catch((err) => sendJson(res, { ok: false, error: (err as Error).message }, 500));
          return;
        }

        if (route === 'scan' && req.method === 'GET') {
          handleScan()
            .then((data) => sendJson(res, data))
            .catch((err) => sendJson(res, { found: [], subnets: [], error: (err as Error).message }, 500));
          return;
        }

        sendJson(res, { error: 'Unknown LAN endpoint' }, 404);
      });

      // Cleanup server process when Vite shuts down
      server.httpServer?.on('close', () => {
        if (serverProcess) {
          console.log('[LAN] Stopping embedded server...');
          serverProcess.kill();
          serverProcess = null;
          serverReady = false;
        }
      });
    },
  };
}
