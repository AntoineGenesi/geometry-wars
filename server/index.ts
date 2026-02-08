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
const app = express();

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

// Start listening on all interfaces (0.0.0.0) for LAN access
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     GEOMETRY WARS 3D - MULTIPLAYER SERVER                ║
╠══════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}               ║
║  WebSocket endpoint: ws://localhost:${PORT}               ║
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
