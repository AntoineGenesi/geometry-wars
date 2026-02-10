import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { networkInterfaces } from 'os';
import http from 'http';
import path from 'path';

const SERVER_PORT = 2567;

function getLANAddresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      addresses.push(iface.address);
    }
  }
  return addresses;
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
        execSync(`fuser -k ${SERVER_PORT}/tcp 2>/dev/null || true`, { timeout: 3000 });
      } catch {
        // Ignore errors (fuser may not be available, or no process on port)
      }
      // Give the OS time to release the port
      setTimeout(resolve, 500);
    });
  }

  async function handleStart(options?: { shutdownTimeout?: number }): Promise<{ ok: boolean; addresses: string[]; port: number; error?: string }> {
    const addresses = getLANAddresses();

    // Already hosting (we spawned this process ourselves)
    if (serverProcess && serverReady) {
      // Verify our own server is still healthy
      if (await checkServerHealth()) {
        return { ok: true, addresses, port: SERVER_PORT };
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
      return { ok: true, addresses, port: SERVER_PORT };
    }

    // If something is on the port but failed deep check, kill it
    if (await checkServerHealth()) {
      console.log('[LAN] Stale server detected on port ' + SERVER_PORT + ', killing...');
      await killStaleServer();
    }

    // Start the Colyseus server as child process
    const binPath = path.join(process.cwd(), 'node_modules', '.bin');
    const shutdownTimeout = options?.shutdownTimeout ?? 180;
    const env = {
      ...process.env,
      PATH: `${binPath}:${process.env.PATH ?? ''}`,
      PORT: String(SERVER_PORT),
      SHUTDOWN_TIMEOUT: String(shutdownTimeout),
    };

    serverProcess = spawn('tsx', ['server/index.ts'], {
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
        return { ok: true, addresses, port: SERVER_PORT };
      }
    }

    // Failed - cleanup
    serverProcess?.kill();
    serverProcess = null;
    return { ok: false, addresses, port: SERVER_PORT, error: 'Server failed to start within 15s' };
  }

  async function handleStop(): Promise<{ ok: boolean }> {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
      serverReady = false;
    }
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

    // Include self if hosting
    if (serverReady) {
      const selfRooms = await fetchRooms('localhost', SERVER_PORT);
      for (const addr of addresses) {
        found.push({ ip: addr, port: SERVER_PORT, info: { game: 'geometry-wars-3d', self: true }, rooms: selfRooms });
      }
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
          sendJson(res, {
            hosting: serverProcess !== null && serverReady,
            addresses: getLANAddresses(),
            port: SERVER_PORT,
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
