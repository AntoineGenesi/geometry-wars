import express from 'express';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 2567;
// Auto-shutdown timeout (ms). Server shuts down if no clients are connected
// for this duration. Set via SHUTDOWN_TIMEOUT env var (in seconds).
// Default: 180 seconds (3 minutes). Set to 0 to disable.
const SHUTDOWN_TIMEOUT_MS = (Number(process.env.SHUTDOWN_TIMEOUT) || 180) * 1000;
const app = express();

// CORS headers for LAN access (allow any origin to connect)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Serve static files from dist folder in production
app.use(express.static(path.join(__dirname, '../dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// LAN discovery endpoint - identifies this as a Geometry Wars server
app.get('/api/info', (req, res) => {
  res.json({
    game: 'geometry-wars-3d',
    version: '0.1.0',
    port: PORT,
  });
});

// Room listing endpoint - returns active game rooms for lobby browser
app.get('/api/rooms', async (_req, res) => {
  try {
    const rooms = await gameServer.matchMaker.query({});
    const roomList = rooms.map((r) => ({
      roomId: r.roomId,
      name: r.name,
      clients: r.clients,
      maxClients: r.maxClients,
      metadata: r.metadata || {},
    }));
    res.json({ rooms: roomList });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ rooms: [], error: message });
  }
});

// Create HTTP server
const httpServer = createServer(app);

// Create Colyseus server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

// Register game room
gameServer.define('game', GameRoom);

// ---- Auto-shutdown when no clients are connected ----
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
let totalConnections = 0;

function checkAutoShutdown() {
  if (SHUTDOWN_TIMEOUT_MS <= 0) return; // Disabled

  // Query active rooms to count clients
  gameServer.matchMaker.query({}).then((rooms) => {
    const totalClients = rooms.reduce((sum, r) => sum + r.clients, 0);

    if (totalClients === 0 && totalConnections > 0) {
      // No clients connected and at least one client has connected previously
      if (!shutdownTimer) {
        const timeoutSec = Math.round(SHUTDOWN_TIMEOUT_MS / 1000);
        console.log(`[Server] No clients connected. Auto-shutdown in ${timeoutSec}s...`);
        shutdownTimer = setTimeout(() => {
          console.log('[Server] Auto-shutdown: no clients for timeout period. Exiting.');
          gameServer.gracefullyShutdown().then(() => process.exit(0));
        }, SHUTDOWN_TIMEOUT_MS);
      }
    } else {
      // Clients connected - cancel any pending shutdown
      if (shutdownTimer) {
        console.log('[Server] Client connected - auto-shutdown cancelled.');
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }
      if (totalClients > 0) {
        totalConnections = Math.max(totalConnections, totalClients);
      }
    }
  }).catch(() => {
    // Ignore errors during shutdown check
  });
}

// Check every 10 seconds
setInterval(checkAutoShutdown, 10_000);

// Track connections via GameRoom hooks
const origOnJoin = GameRoom.prototype.onJoin;
GameRoom.prototype.onJoin = function(client, options) {
  totalConnections++;
  if (shutdownTimer) {
    console.log('[Server] Client connected - auto-shutdown cancelled.');
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  return origOnJoin.call(this, client, options);
};

// Also check on leave — triggers faster shutdown detection than the 10s poll
const origOnLeave = GameRoom.prototype.onLeave;
GameRoom.prototype.onLeave = function(client, consented) {
  const result = origOnLeave.call(this, client, consented);
  // Schedule a check shortly after leave to detect empty server sooner
  setTimeout(checkAutoShutdown, 2000);
  return result;
};

// Expose shutdown timeout config via API
app.get('/api/config', (_req, res) => {
  res.json({
    shutdownTimeoutSeconds: Math.round(SHUTDOWN_TIMEOUT_MS / 1000),
    autoShutdownEnabled: SHUTDOWN_TIMEOUT_MS > 0,
  });
});

// Start listening on all interfaces (0.0.0.0) for LAN access
httpServer.listen(PORT, '0.0.0.0', () => {
  const timeoutSec = Math.round(SHUTDOWN_TIMEOUT_MS / 1000);
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     GEOMETRY WARS 3D - MULTIPLAYER SERVER                ║
╠══════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}               ║
║  WebSocket endpoint: ws://localhost:${PORT}               ║
║  Auto-shutdown: ${SHUTDOWN_TIMEOUT_MS > 0 ? `${timeoutSec}s after last client` : 'disabled'}             ║
║                                                          ║
║  To play:                                                ║
║  1. Open http://localhost:3000?mode=network              ║
║  2. Each player connects from their browser              ║
║  3. First player to click "Start" begins the game        ║
╚══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  gameServer.gracefullyShutdown().then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  gameServer.gracefullyShutdown().then(() => {
    process.exit(0);
  });
});
