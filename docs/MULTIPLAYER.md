# Multiplayer

## Local Splitscreen

URL: `http://localhost:3000?mode=multiplayer`

Two players share one screen on the same surface.

### Controls

| Action | Player 1 | Player 2 |
|--------|----------|----------|
| Move | WASD | IJKL |
| Aim | Mouse | Auto-aim (shoots in movement direction) |
| Shoot | Left click | O |
| Bomb | Space | P |

Camera follows the midpoint of both players. Scoring is combined.

Source: `src/multiplayer-main.ts`, `src/input/MultiplayerInput.ts`

## Network Multiplayer

URL: `http://localhost:3000?mode=network`

Up to 4 players on the same surface with server-authoritative state synchronization.

### Setup

```bash
npm run server                  # Start Colyseus server on port 2567
```

Then open the client:
- Local: `http://localhost:3000?mode=network`
- Remote: `http://localhost:3000?mode=network&server=ws://hostname:2567`

Source: `src/network-main.ts`, `src/network/NetworkClient.ts`, `server/`

## LAN Hosting

Play with friends on the same WiFi network. No separate server required in dev mode.

### Host a Game

1. Run `npm run dev`
2. Click **LAN** in the start menu
3. Click **HOST GAME** - the embedded server starts automatically
4. Share the displayed URL with LAN players (e.g. `http://192.168.1.15:3000?mode=network&server=ws://192.168.1.15:2567`)
5. Click **ENTER GAME** to join your own server

### Join a Game

1. Run `npm run dev`
2. Click **LAN** in the start menu
3. Either:
   - Click **SCAN LAN** to auto-discover games on the local network
   - Enter the host's IP address and click **CONNECT**

### How It Works

A Vite plugin (`vite-plugin-lan.ts`) manages the embedded Colyseus server:
- `POST /__lan/start` spawns the server as a child process
- `POST /__lan/stop` kills it
- `GET /__lan/status` returns hosting state + LAN IP addresses
- `GET /__lan/scan` scans the local /24 subnet for game servers (via `/api/info` endpoint)

The LAN feature only works in dev mode (requires the Vite dev server). For production deployments, use the Network Multiplayer setup with `npm run server`.

Source: `vite-plugin-lan.ts`, `src/network/LANClient.ts`, `src/ui/StartMenu.ts`

## Kill Attribution

Bullets carry an `ownerId` field identifying the player who fired them. When an enemy dies, the system determines kill credit and assists.

- **Kill credit**: Goes to the player whose bullet dealt the killing blow.
- **Damage tracking**: Each enemy maintains a `damageBy` map recording total damage dealt by each player.
- **Assist threshold**: A player qualifies for an assist if they dealt at least 20% of the enemy's max HP.
- **Assist reward**: 40% of the enemy's base score value.

Both kills and assists increment a player's `totalKillAssists` counter, which drives the aura tier system.

Source: `src/multiplayer/KillTracker.ts`

## Aura System

Players build an aura based on their combined kill + assist count. The aura buffs nearby allies.

### Tier Progression

| Tier | Threshold | Outer Ring | Inner Ring |
|------|-----------|------------|------------|
| 0 | 0 | None | None |
| 1 | 10 kills+assists | 3.0 radius, +15% damage, 0.5 HP/s heal | None |
| 2 | 25 | 4.0 radius, +25% damage, 1.0 HP/s | None |
| 3 | 50 | 5.0 radius, +20% damage, 1.0 HP/s | 2.5 radius, +40% damage, 2.0 HP/s |
| 4 | 80 | 6.0 radius, +25% damage, 1.5 HP/s | 3.0 radius, +50% damage, 3.0 HP/s |
| 5 | 120 | 7.0 radius, +30% damage, 2.0 HP/s | 4.0 radius, +60% damage, 4.0 HP/s |

### Ring Visuals

- **Outer ring** (cyan): Appears at tier 1. Pulses gently. Brighter when actively buffing an ally.
- **Inner ring** (magenta): Appears at tier 3. Stronger buffs for allies inside the inner radius.

### Healing

Heal rate from ally auras accumulates HP over time. When accumulated healing reaches 30 HP, the player gains +1 life (capped at 9 lives max).

### How Buffs Apply

Buffs are directional: player A's aura affects player B (and vice versa), but a player does not buff themselves. When multiple allies overlap, the strongest buff from any source applies (max, not additive).

Source: `src/multiplayer/AuraSystem.ts`
