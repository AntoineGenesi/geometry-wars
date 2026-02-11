# Browser 3D Games Landscape Research

**Date:** 2026-02-12
**Purpose:** Understand the competitive landscape of browser-based 3D games, technology patterns, performance benchmarks, and monetization strategies relevant to Geometry Wars 3D.

---

## Table of Contents

1. [Case Studies: Successful Browser 3D Games](#1-case-studies-successful-browser-3d-games)
2. [Technology Patterns](#2-technology-patterns)
3. [Performance Benchmarks](#3-performance-benchmarks)
4. [Games on 3D Surfaces](#4-games-on-3d-surfaces)
5. [The "Instant Play" Model](#5-the-instant-play-model)
6. [Multiplayer Architecture in Practice](#6-multiplayer-architecture-in-practice)
7. [Revenue & Market](#7-revenue--market)
8. [User-Generated Content & Custom Models](#8-user-generated-content--custom-models)
9. [Lessons for Geometry Wars 3D](#9-lessons-for-geometry-wars-3d)

---

## 1. Case Studies: Successful Browser 3D Games

### Tier 1: Massive Scale (100M+ lifetime players)

#### Krunker.io
| Attribute | Detail |
|-----------|--------|
| **Genre** | 3D FPS (Minecraft aesthetic, CoD gameplay) |
| **Engine** | Three.js (custom WebGL renderer) |
| **Backend** | Node.js (rewritten from open-source CS server template) |
| **Lifetime Players** | 200M+ (at time of FRVR acquisition, May 2022) |
| **Peak CCU (Steam)** | 2,250 (browser CCU much higher, not publicly reported) |
| **Revenue** | Undisclosed; FRVR raised $76M partly to enhance Krunker |
| **Monetization** | Cosmetics, marketplace, in-game currency (KR) |
| **Mobile** | Limited; primarily desktop browser + Steam client |
| **Entity Count** | Low-poly environment, ~20-30 players per match |
| **Notable** | Acquired by FRVR in 2022. Custom map editor drove massive community engagement. |

*Sources: [FRVR acquisition announcement](https://corp.frvr.com/news/frvr-acquires-popular-free-to-play-shooter-krunker-io-2/), [ioground history](https://ioground.com/blog/the-history-behind-krunker-io), [Hacker News](https://news.ycombinator.com/item?id=21580747)*

#### Shell Shockers
| Attribute | Detail |
|-----------|--------|
| **Genre** | 3D FPS (egg characters with guns) |
| **Engine** | Babylon.js |
| **Developer** | Blue Wizard Digital |
| **Lifetime Players** | 200M+ |
| **Peak DAU** | 300,000-350,000 (during school year) |
| **Revenue** | Low seven figures annually |
| **Monetization** | 80-90% ads, 10-20% microtransactions (50/50 cosmetics/VIP) |
| **Mobile** | Yes; 39% of players on Chromebooks |
| **Infrastructure** | 10,000+ simultaneous players across servers |
| **Notable** | Multi-million dollar web game success story. School/Chromebook market is critical. |

*Sources: [GameDiscover deep dive](https://newsletter.gamediscover.co/p/deep-dive-shell-shockers-multi-million), [CrazyGames](https://www.crazygames.com/game/ev-io), [Babylon.js forum](https://forum.babylonjs.com/t/deep-dive-shell-shockers-multi-million-web-game-success/37927)*

#### 1v1.LOL
| Attribute | Detail |
|-----------|--------|
| **Genre** | 3D Fortnite-style builder/shooter |
| **Developer** | JustPlay.LOL (acquired by Playtika in 2022) |
| **Players** | 80M+ downloads worldwide |
| **Revenue** | $4.6M annually (JustPlay.LOL total) |
| **Mobile** | Yes; cross-platform browser + mobile apps |
| **Notable** | Fortnite-style building mechanics in browser. |

*Sources: [ActivePlayer](https://activeplayer.io/steam/1v1-lol/), [Apollo company profile](https://www.apollo.io/companies/JustPlay-LOL/5e582ead54c3e100010c3c78)*

### Tier 2: Large Scale (1M-100M players)

#### ev.io
| Attribute | Detail |
|-----------|--------|
| **Genre** | 3D Arena FPS (Halo/Quake-inspired) |
| **Engine** | Three.js |
| **Developer** | Enthusiast Gaming |
| **MAU** | 1M monthly active users |
| **Revenue** | Web3/blockchain model (Solana), NFT cosmetics, in-game billboards |
| **Monetization** | Hybrid: ads + play-to-earn (EVIO token) + NFT skins |
| **Mobile** | Desktop browsers primarily |
| **Notable** | Launched Jan 2021 as pure web game, added Web3 in 2022. Shows Web3 integration path for browser games. |

*Sources: [Fractal blog](https://medium.com/fractal-blog/how-ev-io-became-one-of-the-biggest-web3-games-with-fractal-8178da96f870), [DappRadar](https://dappradar.com/dapp/ev-io)*

#### Narrow One
| Attribute | Detail |
|-----------|--------|
| **Genre** | 3D archery CTF (5v5 medieval) |
| **Engine** | Unity WebGL |
| **Developer** | Pelican Party Studios (2-person team: Jesper & Jurgen) |
| **Platforms** | Browser, iOS, Android, Steam |
| **Monetization** | Free-to-play with ads |
| **Mobile** | Full mobile support |
| **Notable** | Console-quality graphics from a 2-person team. Available on Poki + CrazyGames + app stores. Unity WebGL running well on Chromebooks. |

*Sources: [itch.io](https://pelicanparty.itch.io/narrow-one), [CrazyGames](https://www.crazygames.com/game/narrow-one), [Pelican Party](https://pelicanparty.games/narrow-one)*

#### War Brokers
| Attribute | Detail |
|-----------|--------|
| **Genre** | 3D multiplayer shooter with vehicles |
| **Developer** | Trebuchet Entertainment |
| **Max Players** | 16 per match (browser performance limitation) |
| **Maps** | 9 unique maps |
| **Weapons** | 17 weapons, 5 game modes |
| **Player Count** | Low (13-40 concurrent on Steam; higher in browser) |
| **Notable** | Vehicles (APCs, tanks, helicopters) in browser. Limited to 16 players due to browser performance constraints. |

*Sources: [CrazyGames](https://www.crazygames.com/game/war-brokers-io), [SteamSpy](https://steamspy.com/app/750470)*

### Tier 3: The .io Pioneers (Massive but 2D)

#### Agar.io
| Attribute | Detail |
|-----------|--------|
| **Genre** | 2D massively multiplayer cell eating |
| **Tech** | HTML5 Canvas + WebSocket |
| **Creator** | Matheus Valadares (acquired by Miniclip, then Tencent in 2015) |
| **Revenue** | ~$9K/month currently (peaked much higher) |
| **Notable** | Launched the entire .io genre. Simple tech, massive cultural impact. |

*Sources: [Wikipedia](https://en.wikipedia.org/wiki/Agar.io), [Quora](https://www.quora.com/How-much-did-the-Agar-io-creator-earn-for-his-game)*

#### Slither.io
| Attribute | Detail |
|-----------|--------|
| **Genre** | 2D massively multiplayer snake |
| **Tech** | HTML5 Canvas + WebSocket |
| **Creator** | Steve Howse |
| **Downloads** | 68M+ mobile downloads by Sept 2017 |
| **Peak Revenue** | $100,000/day at peak |
| **Server Capacity** | 500-600 players per server |
| **Infrastructure** | Bare metal servers (avoided AWS due to bandwidth costs) |
| **Monetization** | Ads after death; $3.99 to remove ads |
| **Notable** | Solo developer. Infrastructure was the hardest problem. Bandwidth costs drove server decisions. |

*Sources: [Wikipedia](https://en.wikipedia.org/wiki/Slither.io), [Digital Trends](https://www.digitaltrends.com/gaming/viral-app-slither-pulls-100k-per-day/), [Loop Insight](https://www.loopinsight.com/2016/06/20/slither-io-game-goes-viral-brings-developer-100k-a-day/)*

#### Diep.io / Surviv.io / Zombs Royale
| Game | Genre | Tech | Notable |
|------|-------|------|---------|
| Diep.io | 2D tank arena | HTML5 Canvas + WebSocket | Tank upgrade trees, skill-based |
| Surviv.io | 2D battle royale | HTML5 Canvas + WebSocket | Shut down 2023 (Kongregate) |
| Zombs Royale | 2D battle royale (100 player) | HTML5 Canvas | Still active on zombsroyale.io |

### Tier 4: Notable Three.js Games

#### PolyTrack
| Attribute | Detail |
|-----------|--------|
| **Genre** | Low-poly racing with track editor |
| **Engine** | Three.js + Bullet Physics (WASM) |
| **Developer** | Kodub |
| **Platforms** | Browser (itch.io, Poki, CrazyGames) |
| **Mobile** | Yes, optimized for various devices |
| **Notable** | Built-in track editor with export/share. Three.js + WASM physics engine. Achieves 60+ FPS. Community-driven UGC. |

*Sources: [itch.io](https://kodub.itch.io/polytrack), [Kodub](https://www.kodub.com/)*

---

## 2. Technology Patterns

### Engine Distribution Among Successful Browser 3D Games

| Engine | Games Using It | Market Position |
|--------|---------------|-----------------|
| **Three.js** | Krunker.io, ev.io, PolyTrack, numerous indie titles | Most popular for custom 3D browser games |
| **Babylon.js** | Shell Shockers, several MMOs | Second most popular; better built-in game features |
| **Unity WebGL** | Narrow One, many CrazyGames/Poki titles | Dominant for studios already using Unity |
| **Custom WebGL** | Agar.io, Slither.io, Diep.io | Used for 2D .io games (Canvas + WebGL) |
| **PlayCanvas** | Various commercial projects | Lightweight; used in enterprise/advergaming |

### Three.js vs Babylon.js for Game Development

| Factor | Three.js | Babylon.js |
|--------|----------|------------|
| **Bundle size** | ~168 KB (min+gzip) | ~1.4 MB (full); modular imports available |
| **Raw FPS** | Slightly higher out-of-box | Slightly lower, but more stable |
| **Game features** | Minimal (bring your own) | Physics, collision, particles built-in |
| **Learning curve** | Lower barrier to entry | Steeper but more complete |
| **Community** | Larger (GitHub stars, npm downloads) | Smaller but strong (Microsoft-backed) |
| **WebGPU support** | TSL renderer (Three.js r168+) | Full WebGPU support since Babylon 6.0 |
| **Recommendation** | Best for: custom engines, minimal footprint | Best for: full-featured game engines |

**Our choice (Three.js) is validated:** Krunker.io (200M+ players) and ev.io (1M MAU) both chose Three.js. The smaller bundle size and flexibility for custom rendering pipelines (like our InstancedMesh + bloom approach) make it the right call for a neon-aesthetic arcade shooter.

### Networking Stack Patterns

| Approach | Used By | Pros | Cons |
|----------|---------|------|------|
| **WebSocket (Socket.IO)** | Agar.io, Slither.io, most .io games | Simple, reliable, wide support | TCP head-of-line blocking, ~10-15ms extra latency |
| **WebSocket (Colyseus)** | TOSIOS, various indie | Authoritative server, state sync, matchmaking | Node.js single-threaded limitations |
| **WebRTC (geckos.io)** | Some action games | UDP-like unordered delivery, lower latency | Complex setup (SDP signaling), harder debugging |
| **Custom WebSocket** | Krunker.io, Slither.io | Full control, optimized binary protocols | More development effort |

**Key insight:** Most successful browser games use WebSocket, not WebRTC. The 10-15ms latency difference rarely matters except for competitive FPS at the highest level. WebSocket reliability matters more than WebRTC's lower latency for most game types.

**Our choice (Colyseus + researching geckos.io)** is well-aligned. Colyseus handles the authoritative server pattern well. WebRTC via geckos.io could be a future optimization for LAN play where latency matters most.

### Backend Language

| Language | Used By | Notes |
|----------|---------|-------|
| **Node.js** | Krunker.io, most .io games, Colyseus | Standard for browser game backends |
| **Go** | Some competitive games | Better concurrency, lower latency |
| **Rust** | Emerging | Best performance, complex development |
| **C++** | Rare in browser games | Overkill for most use cases |

Most browser games use Node.js backends. JavaScript performance limitation (vs compiled languages) is real but manageable at the scale of browser games (16-100 players per room, not thousands).

---

## 3. Performance Benchmarks

### Entity Counts in Browser Games

| Game Type | Typical Entity Count | Rendering Approach |
|-----------|---------------------|-------------------|
| .io games (2D) | 100-600 per server | Canvas2D, simple sprites |
| 3D FPS (Krunker, ev.io) | 20-30 players + projectiles (~100-200 total) | Low-poly meshes, Three.js |
| Shell Shockers | 10,000+ simultaneous (across servers) | Babylon.js, per-room ~20 players |
| Geometry Wars 3D (ours) | 10,000+ entities single-client | InstancedMesh, SpatialHash, LOD |

**Our 10K+ entity target is ambitious but achievable.** Most browser 3D games cap at 20-30 visible entities because they render individual meshes. Our InstancedMesh approach (1 draw call per entity type) allows dramatically higher counts. This is a genuine competitive advantage.

### FPS Targets

| Platform | Target FPS | Achievable with |
|----------|-----------|-----------------|
| Desktop Chrome | 60 FPS | Standard for all browser games |
| Desktop Firefox | 60 FPS | Slightly lower WebGL perf than Chrome |
| Mobile Safari | 30-60 FPS | Depends heavily on device generation |
| Chromebook | 30-60 FPS | Critical market (39% of Shell Shockers) |
| Low-end mobile | 30 FPS | Requires aggressive LOD + quality scaling |

### WebGL vs WebGPU Performance (2026)

| Metric | WebGL 2.0 | WebGPU | Improvement |
|--------|-----------|--------|-------------|
| Draw calls | Sequential, single-threaded | Multi-threaded command encoding | ~10x cheaper |
| Particle systems | CPU-bound (10K particles = ~30ms) | Compute shaders (100K particles < 2ms) | ~150x for particles |
| Render bundles | N/A | Pre-recorded command buffers | ~10x scene rendering |
| Data visualization | Canvas2D crawls at 100K points | 1M points at 60 FPS | Order of magnitude |
| Browser support | ~100% of browsers | ~73% of global users (growing) | Coverage gap shrinking |

**WebGPU status (Feb 2026):**
- Chrome + Edge: Supported since v113 (2023) on Windows, macOS, ChromeOS, Android
- Firefox: Supported since v141 (2025) on Windows, macOS
- Safari: Supported since v26 (Sept 2025) on macOS, iOS, iPadOS, visionOS
- Linux: In progress (Mozilla targeting 2026)
- **~73% of users have WebGPU by default**
- Full AAA game adoption projected for 2027

**For Geometry Wars 3D:** WebGPU with WebGL2 fallback is the right strategy. Our neon particle effects would benefit enormously from compute shaders (150x particle performance). The 73% coverage is sufficient for WebGPU-first with graceful degradation.

### Mobile Browser Performance

Mobile is a critical consideration since the core experience is "scan QR, play on phone."

| Device Tier | Expected FPS (WebGL) | Notes |
|-------------|---------------------|-------|
| Flagship 2024+ (iPhone 15, Pixel 8) | 60 FPS | No issues |
| Mid-range 2023+ | 30-60 FPS | Need adaptive quality |
| Budget 2022+ | 20-30 FPS | Need aggressive LOD, reduced particles |
| Chromebook | 30-60 FPS | WebGL 2.0 varies widely; critical market |
| Old devices (<2021) | <20 FPS | Not realistically supportable for 3D |

---

## 4. Games on 3D Surfaces

### Browser Games with 3D Surface Traversal

This is a **very niche category** -- almost no browser games feature gameplay ON 3D surfaces:

| Game | Surface Type | Tech | Status |
|------|-------------|------|--------|
| **Super Monkey Ball (web port)** | Tilting 3D platforms | TypeScript (custom) | Jan 2026 fan remake, runs in Chrome + mobile |
| **Geometry Wars 3: Dimensions** | 15 3D grid surfaces (sphere, cube, cylinder, etc.) | C++ (native, not browser) | Commercial release, NOT browser |
| **shape_wars** | Flat 2D grid (GW1 clone) | HTML5 Canvas, JavaScript | Simple 2D clone, no 3D surfaces |
| **Various itch.io GW clones** | Mostly flat 2D | Various | None have 3D surface walking |

**Key finding: We are operating in an essentially unoccupied niche.** There are NO browser games that combine:
1. Arcade shooter gameplay
2. Walking/fighting ON 3D surfaces (sphere, torus, Mobius strip, etc.)
3. Multiplayer
4. Instant browser play

The closest competition (Geometry Wars 3: Dimensions) is a native game, not browser-based. The Super Monkey Ball web port shows that complex 3D surface physics CAN work in browser (TypeScript + WASM physics), but that's a single-player rolling game, not a shooter.

**Implications:**
- **Opportunity:** First mover in a unique space
- **Risk:** The niche may be unoccupied because the surface traversal problem is genuinely hard (UV discontinuities, camera orientation, aiming on curved surfaces)
- **Mitigation:** Our 12-surface system with tangent-frame-based movement is a solved technical challenge

---

## 5. The "Instant Play" Model

### How Top Browser Games Achieve Instant Play

| Game | Initial Load | Strategy |
|------|-------------|----------|
| Agar.io | <1 second | Minimal assets (Canvas2D, no textures) |
| Slither.io | <2 seconds | HTML5 Canvas, tiny JS bundle |
| Krunker.io | 3-5 seconds | Progressive loading, low-poly textures |
| Shell Shockers | 3-5 seconds | Babylon.js with progressive asset loading |
| Narrow One | 5-8 seconds | Unity WebGL (heavier initial load) |

### Platform Requirements

| Platform | Max Initial Download | Load Time Requirement |
|----------|---------------------|----------------------|
| **Poki** | 5-8 MB | Fast loading required |
| **Facebook Instant Games** | 6 MB | 5-second max |
| **CrazyGames** | No hard limit | Fast loading preferred |
| **Standalone (.io)** | No limit | Users expect <5 seconds |

### Key Optimization Techniques

1. **Progressive Loading:** Load core gameplay immediately (~2-3 MB), stream textures/audio after
2. **Service Worker Caching:** 30-50% faster on repeat visits; up to 400% improvement reported
3. **App Shell Pattern:** Cache UI/framework, only fetch dynamic content
4. **Asset Bundling:** Concatenate + version assets with hash, treat as immutable on CDN
5. **Texture Compression:** Basis Universal / KTX2 for GPU-compressed textures (60-80% size reduction)
6. **Code Splitting:** Separate vendor libs from game code for browser caching
7. **WASM for Physics:** PolyTrack uses Bullet Physics compiled to WASM -- faster than JS physics

### For Geometry Wars 3D

Our target: **<3 second load to main menu, <5 seconds to gameplay.**

Current stack implications:
- Three.js (168 KB gzipped) is lightweight
- Vite produces optimized bundles with code splitting
- InstancedMesh means fewer texture assets (procedural geometry)
- Neon aesthetic means fewer texture files (glow is post-processing, not textures)
- Sound synthesis (11 SFX) avoids loading audio files

**Our neon-procedural aesthetic is a major advantage for load times.** Games with realistic textures (Narrow One, War Brokers) need to load MB of image data. Our look is generated in shaders.

---

## 6. Multiplayer Architecture in Practice

### How .io Games Scale

| Component | Typical Approach |
|-----------|-----------------|
| **Protocol** | WebSocket (TCP), binary messages for bandwidth |
| **Rooms** | 20-600 players per room/server instance |
| **State Sync** | Server-authoritative; delta updates at 10-20 Hz |
| **Matchmaking** | Geographic + room fill; simple lobby or auto-join |
| **Hosting** | Bare metal (bandwidth-sensitive) or managed (Hathora, etc.) |
| **Scaling** | Horizontal: each room is an independent process |

### Cost Economics

| Metric | Value | Source |
|--------|-------|--------|
| **Bare metal server** | $5/month (200 CCU) | KinematicSoup analysis |
| **Bandwidth per MACCU** | $4-10/month | KinematicSoup analysis |
| **Ad revenue per MACCU** | $0.007-12/month | Varies wildly by game engagement |
| **Break-even** | ~3,500 ad impressions per MACCU | ~1 ad per 12.5 min gameplay |
| **Slither.io bandwidth** | 300-400 kbps per player | Avoided AWS due to cost |

### Infrastructure Choices

| Approach | Used By | Cost | Flexibility |
|----------|---------|------|-------------|
| **AWS/GCP/Azure** | Well-funded studios | $$$$ (bandwidth expensive) | High |
| **Bare metal (Hetzner, OVH)** | Slither.io, budget games | $ | Medium |
| **Hathora** | Indie multiplayer | $$ (managed, 12 regions) | High |
| **Colyseus Cloud** | Colyseus users | $$ (managed) | Medium |
| **Self-hosted** | LAN/local games | Free | Low scalability |

### Key Lessons for Our Multiplayer

1. **Start with LAN:** Our "QR code + phone" model works perfectly for LAN. No cloud costs.
2. **Room-based scaling:** Colyseus rooms scale horizontally. Each game is independent.
3. **Binary protocol matters:** JSON state sync is fine for prototyping but binary is 3-5x more bandwidth-efficient.
4. **Bandwidth is the #1 cost:** Slither.io's developer specifically avoided AWS because bandwidth costs would have destroyed profitability.
5. **WebRTC for LAN:** For same-network play, WebRTC data channels (geckos.io) provide the lowest latency. For internet play, WebSocket is simpler and reliable enough.

---

## 7. Revenue & Market

### Browser Gaming Market Size

| Year | Market Size | CAGR | Source |
|------|------------|------|--------|
| 2024 | $7.73B | - | Business Research Company |
| 2025 | $8.0B | 3.4% | Business Research Company |
| 2030 (projected) | $9.07B | 3.1% | Business Research Company |

### Platform Revenue & Scale

| Platform | Monthly Players | Developer Revenue | Revenue Share |
|----------|----------------|-------------------|---------------|
| **Poki** | 100M+ | Up to $1M/year per game | 50/50 |
| **CrazyGames** | 20M+ | Undisclosed | Varies; +50% for 2-month exclusivity |
| **itch.io** | 700K+ products | Developer-set pricing | 90% to developer (default) |
| **Y8** | Large | 50-65% of ad revenue | 50% base + bonuses |
| **Facebook Instant Games** | Massive but declining | 70% (non-mobile) | Facebook takes 30% on IAP |

### Developer Success Stories

| Developer/Game | Revenue/Scale | Time to Build | Team Size |
|----------------|--------------|---------------|-----------|
| **Shell Shockers** | Low seven figures/year | Years of iteration | Small studio (Blue Wizard) |
| **Slither.io** | $100K/day at peak | 6 months | 1 person |
| **Blumgi (Poki)** | 100M players in 2 years | Catalog approach | 1 person |
| **Poki dev (anonymous)** | 67M plays in 2025 | Hobby since 2020 | 1 person |
| **1v1.LOL** | $4.6M/year | Unknown | Studio (acquired by Playtika) |
| **Vibe Coding winner** | $50K MRR | Few weeks (AI-assisted) | 1 person |

### Monetization Models

| Model | Revenue Range | Best For | Example |
|-------|-------------|----------|---------|
| **Ads only** | $0.007-12/MACCU | High-traffic casual | Agar.io, Slither.io |
| **Ads + cosmetics** | Low seven figures/year | Engaged community | Shell Shockers |
| **Ads + VIP** | Mid-tier | Competitive games | Shell Shockers VIP |
| **Cosmetics only** | Varies widely | Strong brand/community | Krunker.io marketplace |
| **Web3/NFT** | Volatile | Speculative | ev.io |
| **Platform placement** | Up to $1M/year | Poki/CrazyGames games | Top Poki titles |

### Ad Revenue Specifics

| Metric | Value |
|--------|-------|
| **ARPDAU (hyper-casual)** | $0.05 |
| **ARPDAU (mid-core)** | $0.12 |
| **Rewarded video eCPM (US)** | $16-20 |
| **Offerwall eCPM** | $500+ |
| **RPM (browser games)** | $1-5 per 1,000 impressions |

### Growth Drivers (2025-2026)

- 16% of game developers actively targeting web browser releases (up from 10% in 2024)
- Cross-platform play (phone + desktop) is a key differentiator
- 5G mobile coverage improving mobile browser game viability
- WebGPU narrowing the quality gap between browser and native
- "Vibe coding" with AI lowering development barriers

---

## 8. User-Generated Content & Custom Models

### Browser Games with UGC

| Game | UGC Type | Technology | Impact |
|------|----------|-----------|--------|
| **Krunker.io** | Custom maps | Built-in editor | Massive community engagement |
| **PolyTrack** | Custom racing tracks | Built-in editor, export/share | Community-driven content |
| **MakeCode Arcade** | Full games | Block programming | Educational |
| **Narrow One** | Limited | Server-side maps | Developer-controlled |

### 3D Model Loading in Browser

| Format | Size | Browser Support | Best For |
|--------|------|----------------|----------|
| **GLB (binary glTF)** | Compact (single file) | All modern browsers via Three.js/Babylon.js | Standard for web 3D |
| **GLTF** | Larger (multiple files) | Same as GLB | Development/editing |
| **OBJ** | Legacy | Widely supported | Simple models |
| **FBX** | Large | Via loaders | Unity export pipeline |

**GLB is the standard** for web 3D model delivery. Three.js has excellent GLB support via GLTFLoader. For a potential future map editor, users could create surfaces in Blender and export as GLB.

---

## 9. Lessons for Geometry Wars 3D

### What We're Doing Right

1. **Three.js is the right engine.** Krunker (200M players) and ev.io (1M MAU) validate this choice. Smaller bundle than Babylon.js, sufficient for custom rendering.

2. **InstancedMesh for high entity counts.** No other browser game targets 10K+ entities. This is a genuine differentiator. Most browser 3D games have 20-30 visible entities.

3. **Neon procedural aesthetic.** Eliminates texture loading bottleneck. Shell Shockers and Krunker load textures; we generate visuals in shaders. Faster load times.

4. **WebGPU with WebGL2 fallback.** With 73% WebGPU coverage and growing, this is future-proof. Our particle systems would see 150x improvement on WebGPU.

5. **Colyseus for multiplayer.** Standard choice for Node.js authoritative game servers. Horizontal scaling via rooms.

6. **"Scan QR, play instantly" model.** AirConsole and Gaming Couch validate this UX pattern. No other 3D shooter does this.

### What We Should Consider

1. **Chromebook market is critical.** 39% of Shell Shockers players are on Chromebooks. Our adaptive quality system must handle these devices well. WebGL 2.0 performance varies widely on Chromebooks.

2. **Bundle size discipline.** Poki requires 5-8 MB initial download. Our current bundle should be audited against this target.

3. **Platform distribution.** Games on Poki earn up to $1M/year. CrazyGames reaches 20M players. We should plan for platform distribution, not just standalone hosting.

4. **Map editor as growth engine.** Krunker's community maps drove massive engagement. PolyTrack's track editor created organic content. A surface/level editor could be our UGC play.

5. **Progressive loading.** Load main menu and first surface immediately. Stream additional surfaces, audio, and effects in background.

6. **Binary protocol for multiplayer.** Move from JSON state sync to binary for 3-5x bandwidth savings when scaling to internet play.

7. **Bare metal hosting for scale.** If we go beyond LAN, bandwidth costs on cloud providers are prohibitive. Slither.io's lesson: bare metal servers or managed gaming infrastructure (Hathora).

### Our Unique Position

No browser game combines ALL of:
- 3D surface traversal (12+ surfaces)
- High entity counts (10K+)
- Neon arcade aesthetic with bloom/particles
- Instant QR-code multiplayer
- Mobile + desktop cross-play

**This is genuinely novel.** The closest competitor (Geometry Wars 3: Dimensions) is a paid native game with no browser play, no phone-as-controller, and limited multiplayer. The browser 3D game space has shooters (Krunker, ev.io), but none with the surface-walking mechanic.

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Surface traversal too niche | Medium | Market as unique, not as limitation |
| Mobile performance | High | Adaptive quality already built; test on Chromebooks |
| Multiplayer complexity (LAN) | High | Start with LAN, proven Colyseus patterns |
| Load time too slow | Medium | Procedural aesthetic helps; audit bundle |
| Discoverability | High | Platform distribution (Poki/CrazyGames) + QR viral loop |
| Monetization | Medium | Proven models: ads + cosmetics + platform revenue |

### Recommended Next Steps (from market perspective)

1. **Audit bundle size** -- target <5 MB for instant play
2. **Test on Chromebooks** -- critical device category
3. **Plan Poki/CrazyGames submission** -- requires 50/50 revenue share but provides distribution
4. **Build simple surface editor** -- community engagement + UGC + organic growth
5. **Profile WebGPU particle path** -- our biggest visual advantage
6. **Implement progressive loading** -- menu in 2s, gameplay in 5s
7. **Prototype AirConsole-style QR join** -- "scan and play" is the unique hook

---

## Sources Index

### Game-Specific
- [FRVR acquires Krunker.io](https://corp.frvr.com/news/frvr-acquires-popular-free-to-play-shooter-krunker-io-2/)
- [Shell Shockers deep dive](https://newsletter.gamediscover.co/p/deep-dive-shell-shockers-multi-million)
- [Slither.io revenue ($100K/day)](https://www.digitaltrends.com/gaming/viral-app-slither-pulls-100k-per-day/)
- [ev.io Web3 success](https://medium.com/fractal-blog/how-ev-io-became-one-of-the-biggest-web3-games-with-fractal-8178da96f870)
- [PolyTrack (Kodub)](https://www.kodub.com/)
- [Super Monkey Ball web port](https://www.pushsquare.com/news/2026/01/bananas-super-monkey-ball-is-now-playable-in-your-web-browser)
- [Krunker.io history](https://ioground.com/blog/the-history-behind-krunker-io)

### Market & Revenue
- [Browser games market size](https://www.thebusinessresearchcompany.com/report/browser-games-global-market-report)
- [Web game market overview (Gamedeveloper.com)](https://www.gamedeveloper.com/business/the-huge-hidden-web-game-market-no-one-talks-about-and-how-to-get-in-)
- [Poki 1 billion plays](https://techfundingnews.com/browser-gaming-website-poki-won-big-at-the-dutch-game-awards-celebrating-hitting-1-billion-monthly-plays/)
- [Web gaming platforms for developers](https://hology.app/blog/web-gaming-1)
- [KinematicSoup economics of web games](https://kinematicsoup.com/news/2019/9/8/the-economics-of-web-based-multiplayer-games)
- [Game monetization 2025](https://infatica-sdk.io/blog/app-monetization/game-monetization-in-2025-top-strategies-for-developers/)
- [Browser game monetization (Venatus)](https://www.venatus.com/publishers/browser-game-monetization)

### Technology
- [WebGPU browser support 2026](https://webo360solutions.com/blog/webgpu-browser-support-2026/)
- [WebGPU all major browsers](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebGPU performance benchmarks](https://www.mayhemcode.com/2025/12/gpu-acceleration-in-browsers-webgpu.html)
- [WebGPU vs WebGL comparison](https://toji.dev/webgpu-best-practices/webgl-performance-comparison.html)
- [Three.js vs Babylon.js](https://blog.logrocket.com/three-js-vs-babylon-js/)
- [WebRTC vs WebSocket for games](https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games)
- [Geckos.io (WebRTC UDP)](https://github.com/geckosio/geckos.io)
- [Hathora multiplayer hosting](https://hathora.dev/docs/engines/javascript)
- [Colyseus framework](https://colyseus.io/)
- [Scalable WebSocket architecture (Hathora blog)](https://blog.hathora.dev/scalable-websocket-architecture/)

### Performance
- [WebGL optimization guide](https://blog.pixelfreestudio.com/how-to-optimize-webgl-for-high-performance-3d-graphics/)
- [JS game rendering benchmark](https://github.com/Shirajuki/js-game-rendering-benchmark)
- [PlayCanvas load time optimization](https://developer.playcanvas.com/user-manual/optimization/load-time/)
- [Unity WebGL performance tips](https://friendzy.xyz/2025/09/17/unity-webgl-performance-tips/)

### Platforms
- [AirConsole (QR-based multiplayer)](https://airconsole.mobi/)
- [Poki for developers](https://developers.poki.com/guide/web-game-engines)
- [CrazyGames developer portal](https://developer.crazygames.com/)
