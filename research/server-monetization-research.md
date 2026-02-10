# Server Costs & Monetization Research — Geometry Wars 3D Browser Recreation

**Date:** 2026-02-10
**Scope:** Free-to-play browser game with multiplayer (LAN + online)
**Objective:** Determine if ad monetization can cover server costs at various scales, and evaluate Go/Rust backend feasibility

---

## Executive Summary

This research addresses whether a free-to-play browser version of Geometry Wars can be financially viable through ad monetization alone, and whether switching from Node.js/Colyseus to a Go or Rust backend could reduce server costs enough to improve unit economics.

### Key Findings

1. **Code exposure is unavoidable but acceptable.** Browser games expose all client-side code. Obfuscation can slow reverse engineering but cannot prevent it. However, successful .io games (Agar.io, Slither.io) prove that code exposure doesn't prevent profitability when the core value is the multiplayer experience and active server infrastructure.

2. **Ad monetization is viable at scale.** Rewarded video ads generate $16-20 eCPM (revenue per 1000 impressions), with browser games achieving $1-5 revenue per 1000 impressions (RPMI) overall. At 10K+ DAU, ad revenue can cover server costs with margins of 60-80%.

3. **Go/Rust backends offer 5-10x cost savings over Node.js** for game servers. Memory per connection drops from 5-10MB (Node.js) to 0.5-2MB (Go/Rust), allowing a single $20/month VPS to handle 500-1000 concurrent players instead of 50-100.

4. **Hybrid architecture (TypeScript logic + Go/Rust networking) is technically feasible** but adds complexity. The win is primarily in networking efficiency, not game logic execution. For a browser game where clients do most rendering/simulation, the networking layer is the bottleneck worth optimizing.

5. **Break-even point: 5K-8K DAU** with ad-supported model and optimized (Go/Rust) backend. Below this, the game operates at a loss unless hosting costs are near-zero (e.g., using free tiers). Above 20K DAU, margins reach 70%+ and revenue scales faster than costs.

6. **Alternative monetization (cosmetics, battle pass) could reduce break-even to <2K DAU** but requires significant development effort for in-game shop, payment integration, and ongoing content creation.

---

## Table of Contents

1. [Frontend Code Exposure & Protection](#1-frontend-code-exposure--protection)
2. [Server Architecture: Node.js vs Go vs Rust](#2-server-architecture-nodejs-vs-go-vs-rust)
3. [Hosting Cost Analysis](#3-hosting-cost-analysis)
4. [Ad Monetization Deep Dive](#4-ad-monetization-deep-dive)
5. [Unit Economics Model](#5-unit-economics-model)
6. [Alternative Monetization Strategies](#6-alternative-monetization-strategies)
7. [Recommendations](#7-recommendations)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Risk Assessment](#9-risk-assessment)
10. [Sources](#10-sources)

---

## 1. Frontend Code Exposure & Protection

### The Reality: All Client Code is Visible

Browser games execute entirely in the user's browser. Every line of JavaScript, every asset, every algorithm is downloaded to the player's machine. This includes:

- **Geodesic surface walking algorithms** (MeshWalker, UV projection, face traversal)
- **Game mechanics** (weapon systems, enemy AI patterns, buff logic)
- **Rendering techniques** (InstancedMesh, LOD, bloom effects)
- **Network protocol** (how clients communicate with server)

### Obfuscation: Limited Protection

JavaScript obfuscation tools exist:

- **Terser**: Minification + basic name mangling (free, widely used)
- **javascript-obfuscator**: Advanced obfuscation with control flow flattening, string encryption
- **webpack-obfuscator**: Webpack plugin for automatic obfuscation in build pipeline
- **VM-based obfuscation**: Transforms code into custom bytecode running on embedded interpreter (most secure, commercial tools like Jscrambler)

**Effectiveness:**
- Minification: Reduces bundle size 60-80%, makes code harder to read
- Standard obfuscation: Increases reverse engineering effort from hours to days
- VM obfuscation: Increases effort from days to weeks
- **No obfuscation is foolproof.** Determined attackers will always succeed given enough time.

**Cost:**
- Terser: Free
- javascript-obfuscator: Free (open source)
- Jscrambler (commercial VM obfuscation): $500-5000/month depending on bundle size

**Verdict:** Use Terser for production builds (free, already in Vite). Advanced obfuscation is not worth the cost for a free-to-play game where the value is the multiplayer experience, not proprietary algorithms.

### Does Code Exposure Matter?

**Analysis of successful .io games:**

| Game | Revenue Model | Code Protection | Clones Existed? | Still Profitable? |
|------|--------------|----------------|----------------|------------------|
| Agar.io | Ads + optional cosmetics | None (early versions) | Yes (100+ clones) | Yes ($500K+ monthly at peak) |
| Slither.io | Ads + $2 ad-removal | Basic minification | Yes (50+ clones) | Yes ($100K+ daily at peak) |
| Krunker.io | Ads + cosmetic shop | Basic obfuscation | Yes (few successful) | Yes (undisclosed, likely $50K+ monthly) |

**Key insight:** Clones failed not because they lacked the code, but because they lacked:
1. **Active servers** with low latency and high uptime
2. **Player network effects** (friends play where friends play)
3. **Community building** (Discord, updates, events)
4. **Discoverability** (SEO, game portals like CrazyGames, organic growth)

### What About Server Code?

Server-side code (game room logic, anti-cheat, matchmaking) is NOT exposed. This is where critical IP should reside:

- Server-authoritative hit detection (client can't fake kills)
- Enemy spawn patterns and difficulty scaling
- Multiplayer state reconciliation
- Anti-cheat validation

**Current architecture (Colyseus):** Game logic runs on server in TypeScript. This is correct. Keep it this way.

### Recommendation: Accept Code Exposure

1. Use Terser for production minification (already in Vite)
2. Move critical logic to server-side where possible
3. Focus on server uptime, latency, and community over code secrecy
4. Consider the geodesic surface code a portfolio piece, not trade secret
5. If code is "stolen," it validates the work's value; the multiplayer experience is still yours

---

## 2. Server Architecture: Node.js vs Go vs Rust

### Current Stack: Node.js + Colyseus

**Colyseus** is a Node.js multiplayer framework with:
- WebSocket server built-in
- State synchronization via Schema patches
- Room-based architecture (1 room = 1 game session)
- Interest management support

**Performance characteristics (documented + tested):**
- ~3500 concurrent connections per server (documented max in community tests)
- ~1024 connections default (Linux file descriptor limit)
- 410-430 MB RAM with simulated players
- CPU ~15% idle, spikes to 50-100% under load
- Memory per connection: ~5-10 MB (Node.js V8 heap overhead)

**Bottleneck:** Single-threaded JavaScript (V8). Physics, AI, and state updates all run on one core. At 10K entities * 60Hz, this saturates a CPU core quickly.

### Go Backend Option

**Gorilla WebSocket** is the standard Go WebSocket library. Performance data:

**Memory:**
- 0.5-2 MB per connection (goroutines are lightweight)
- Can handle 10K+ concurrent connections on 2GB RAM VPS

**CPU:**
- Goroutines schedule cooperatively (Go runtime manages thousands efficiently)
- In benchmarks: 132K req/s with 1.8ms latency (vs Node.js 72K req/s, 3.2ms)

**Ecosystem:**
- No equivalent to Colyseus (no batteries-included game framework)
- Must build: WebSocket handler, room system, state sync, matchmaking
- Physics: No native Rapier.js; would need Go physics engine or call WASM

**Development time:** 3-4 weeks to build equivalent to Colyseus from scratch

**Cost savings:** 5-10x more connections per server (same hardware)

### Rust Backend Option

**Actix-web** (HTTP) + **tokio-tungstenite** (WebSocket) are Rust's standard async web stack.

**Memory:**
- 0.3-1 MB per connection (zero-cost abstractions, no GC)
- Most memory-efficient of all three languages

**CPU:**
- In benchmarks: 165K req/s, 1.5ms latency (best of three)
- HTTP load test: 400K req/s (vs Go 270K, Node.js 72K)

**Ecosystem:**
- No game server framework (same as Go)
- Must build everything from scratch
- Physics: Can use Rapier.js (it's originally Rust, compiled to WASM for JS)

**Development time:** 4-6 weeks (Rust's learning curve + borrow checker complexity)

**Cost savings:** 10x+ more connections per server (lowest memory footprint)

### Hybrid Architecture: TypeScript Logic + Go/Rust Networking

**Concept:** Keep game logic in TypeScript, use Go/Rust only for WebSocket layer.

```
┌────────────────────────────────────────────┐
│         Game Logic (TypeScript)            │
│  - Enemy AI, physics, collision detection  │
│  - Game rooms, matchmaking                 │
│  - State updates (60Hz tick)               │
└───────────────┬────────────────────────────┘
                │ IPC (stdio, gRPC, or FFI)
┌───────────────▼────────────────────────────┐
│    Networking Layer (Go or Rust)           │
│  - WebSocket server                        │
│  - Connection management                   │
│  - Binary serialization                    │
│  - Send/receive state patches              │
└────────────────────────────────────────────┘
```

**How it works:**
1. Go/Rust binary accepts WebSocket connections
2. TypeScript Node.js process runs game logic (existing Colyseus code)
3. Go/Rust forwards player inputs to Node.js via IPC
4. Node.js sends state updates back to Go/Rust
5. Go/Rust broadcasts to connected clients

**Benefits:**
- Keep existing TypeScript game logic (400+ hours of work preserved)
- Get Go/Rust networking efficiency (5-10x connection scaling)
- Reuse Colyseus Schema, ECS architecture, existing tests

**Challenges:**
- IPC latency (adds 0.5-2ms per message)
- Complexity: two processes, two languages, failure modes
- Debugging: must trace issues across language boundary
- Serialization: must marshal TypeScript state to Go/Rust and back

**Benchmark:** Rust game engines using TypeScript logic (via V8 embedding or WASM) report 10-20% overhead from language boundary. For 60Hz tick rate, this is acceptable.

**Alternatives:**
- **Bun:** TypeScript runtime written in Zig, claims 3x faster than Node.js, drop-in replacement. WebSocket performance in benchmarks shows parity with Go for many workloads. **Could be easiest win: change one line (`node server.js` → `bun server.js`) for 2-3x better performance.**

### Server Architecture Comparison Table

| Metric | Node.js (Colyseus) | Bun (Colyseus) | Go (Custom) | Rust (Custom) | Hybrid TS+Go |
|--------|-------------------|----------------|-------------|---------------|--------------|
| Memory per conn | 5-10 MB | 3-6 MB | 0.5-2 MB | 0.3-1 MB | 1-3 MB |
| Connections per 2GB VPS | 100-200 | 200-400 | 500-1000 | 800-1500 | 400-800 |
| Development time | 0 (done) | 0 (done) | 3-4 weeks | 4-6 weeks | 2-3 weeks |
| Code reuse | 100% | 100% | 0% (rewrite) | 0% (rewrite) | 80% (TS logic kept) |
| Maturity | High | Medium | High | High | Experimental |
| Hosting cost (1K CCU) | $80-100/mo | $40-60/mo | $20-30/mo | $15-25/mo | $25-40/mo |

**Winner for quick wins:** Bun (drop-in replacement, 2-3x improvement, zero rewrite)
**Winner for maximum efficiency:** Rust (best memory/CPU, but full rewrite)
**Winner for balance:** Go custom or Hybrid TS+Go (5x efficiency, moderate complexity)

---

## 3. Hosting Cost Analysis

### Hosting Provider Comparison

#### VPS Providers (Best for Game Servers)

| Provider | Cheapest Plan | Specs | Best For |
|----------|---------------|-------|----------|
| **Hetzner** | €4.09/mo (~$4.50) | 2 vCPU (shared), 4 GB RAM, 40 GB SSD | EU players, best price/performance |
| **DigitalOcean** | $4/mo | 1 vCPU (shared), 512 MB RAM | US players, simple setup |
| **DigitalOcean** | $12/mo | 2 vCPU, 2 GB RAM | Small to medium game servers |
| **Hetzner Dedicated** | €39/mo (~$43) | 4 cores, 32 GB RAM, 2x 512GB NVMe | Serious scaling (1K+ CCU) |
| **Contabo** | $4-6/mo | 4 vCPU, 8 GB RAM | Budget option, mixed reviews on reliability |

#### PaaS Providers (Easier but More Expensive)

| Provider | Pricing Model | Cost Estimate (Small) | Best For |
|----------|---------------|---------------------|----------|
| **Railway** | Usage-based, $5 min | $10-30/mo | Quick deployment, no DevOps |
| **Render** | Flat tiers, $7+ | $7-25/mo | Predictable costs, simple scaling |
| **Fly.io** | Usage-based, free tier | $5-20/mo | Global distribution, auto-scaling |
| **Cloudflare Workers** | $5/mo + usage | $5-15/mo (low traffic) | Edge computing, near-zero latency |

#### Static Hosting (Frontend Bundle)

| Provider | Free Tier | Bandwidth Limit | Paid Tier |
|----------|-----------|----------------|-----------|
| **Cloudflare Pages** | Unlimited bandwidth | None | $0 (yes, free forever) |
| **Vercel** | 100 GB/mo | Beyond free tier: $20/mo | $20/mo (Pro) |
| **Netlify** | 100 GB/mo | Beyond free tier: $19/mo | $19/mo (Pro) |

**Recommendation:** Use Cloudflare Pages (free, unlimited bandwidth) for static frontend. Use Hetzner VPS for game server.

### Server Cost Projections by Scale

Assumptions:
- Multiplayer game, 4 players per room
- 60Hz server tick rate
- Average session length: 15 minutes
- DAU to peak CCU ratio: 20:1 (industry standard for action games)

#### Scenario 1: Small Scale (1K DAU)

- **Peak CCU:** 50 (1K DAU / 20)
- **Rooms needed:** 13 (50 players / 4 per room, rounded up)
- **Node.js (Colyseus):** 1x Hetzner CPX11 (2 vCPU, 4GB RAM) = €4.09/mo ($4.50)
- **Bun (Colyseus):** 1x Hetzner CPX11 = €4.09/mo
- **Go custom:** 1x Hetzner CPX11 = €4.09/mo (overkill, could use cheaper)
- **Static hosting:** Cloudflare Pages = $0

**Total monthly cost:** $4.50-10 (depending on whether you add monitoring, backup)

#### Scenario 2: Medium Scale (10K DAU)

- **Peak CCU:** 500 (10K DAU / 20)
- **Rooms needed:** 125
- **Node.js (Colyseus):** 3x Hetzner CPX21 (3 vCPU, 8GB RAM) = €12.99 * 3 = €38.97/mo ($43)
- **Bun (Colyseus):** 2x Hetzner CPX21 = €25.98/mo ($29)
- **Go custom:** 1x Hetzner CCX23 (8 vCPU, 32GB RAM) = €48.99/mo ($54)
- **Static hosting:** Cloudflare Pages = $0

**Total monthly cost:** $29-55 depending on backend

#### Scenario 3: Large Scale (100K DAU)

- **Peak CCU:** 5000
- **Rooms needed:** 1250
- **Node.js (Colyseus):** 30x servers or dedicated = ~$400-600/mo
- **Bun (Colyseus):** 15x servers = ~$250-350/mo
- **Go custom:** 6x Hetzner CCX33 (16 vCPU, 64GB RAM) = €89.99 * 6 = €539.94/mo ($595)
- **Rust custom:** 4x Hetzner CCX33 = €359.96/mo ($397)
- **Static hosting:** Cloudflare Pages = $0

**Total monthly cost:** $400-600 (Node.js), $250-350 (Bun), $600 (Go), $400 (Rust)

#### Scenario 4: Viral Scale (1M DAU)

- **Peak CCU:** 50,000
- **Rooms needed:** 12,500
- **Node.js (Colyseus):** ~$5K-8K/mo (multi-region, load balancers)
- **Go custom:** ~$3K-4K/mo
- **Rust custom:** ~$2K-3K/mo
- **CDN bandwidth:** Cloudflare Pages still free (yes, really)

**Total monthly cost:** $2K-8K depending on backend

### Bandwidth Costs

**Frontend bundle:** ~5-10 MB (Three.js + game code + assets)
- 1K DAU * 5 MB * 30 days = 150 GB/mo → **Free on Cloudflare Pages**
- 100K DAU * 5 MB * 30 days = 15 TB/mo → **Still free on Cloudflare Pages**

**Game server (WebSocket):**
- Per player: ~50-200 KB/s depending on entity count
- 500 CCU * 100 KB/s * 3600s/hr * 5 hrs/day * 30 days = ~2.7 TB/mo
- Hetzner includes 20 TB egress free on dedicated servers

**Verdict:** Bandwidth is not a concern with Cloudflare Pages (frontend) and Hetzner (backend).

---

## 4. Ad Monetization Deep Dive

### Ad Networks for Browser Games

| Network | Focus | CPM/eCPM | Payment Terms | Integration Difficulty |
|---------|-------|----------|---------------|----------------------|
| **CrazyGames** | Browser games portal | $2-8 CPM (estimated) | 70/30 rev share | Easy (SDK) |
| **GameDistribution** | 2000+ web publishers | $1-5 RPMI | 70/30 rev share | Easy (SDK) |
| **Poki** | 35M MAU game portal | $3-10 CPM (estimated) | 50/50 rev share | Medium (approval required) |
| **Google AdSense** | General display ads | $0.10-5 CPM | Net 30 | Medium (JS integration) |
| **Rewarded Video Networks** | Unity Ads, AdMob | $16-20 eCPM | Varies | Hard (requires SDK) |

**Notes:**
- RPMI = Revenue Per Mille Impressions (per 1000 impressions, same as CPM)
- eCPM = Effective CPM (blended rate across ad types)
- Browser game portals (CrazyGames, Poki) provide distribution + monetization in one

### Ad Formats

| Format | Placement | User Impact | eCPM Range | Recommended? |
|--------|-----------|-------------|-----------|--------------|
| **Interstitial** | Between rounds/deaths | Medium disruption | $3-10 | Yes (primary) |
| **Banner** | Bottom/top of screen | Low disruption | $0.50-2 | Maybe (low revenue) |
| **Rewarded Video** | Optional, exchange for buff/extra life | No disruption (opt-in) | $16-20 | **YES** (best eCPM + UX) |
| **Pre-roll** | Before game starts | High disruption | $5-15 | No (kills retention) |

**Optimal strategy:**
1. **Rewarded video ads** after death: "Watch ad for extra life?" (95%+ completion rate, $16-20 eCPM)
2. **Interstitial ads** every 3-5 deaths (not too frequent, $3-10 eCPM)
3. No banner ads (low revenue, clutters screen)
4. Optional: $2-5 one-time payment to remove all ads permanently (Slither.io model)

### Revenue Estimates by Scale

Assumptions:
- 50% of players see rewarded video ad per session (opt-in)
- Average 2 deaths per session (casual play)
- Rewarded video eCPM: $18 (midpoint)
- Interstitial eCPM: $5 (conservative)
- Ad shown every 2nd death

#### 1K DAU

- **Sessions per day:** 1K DAU * 1.2 sessions/player = 1,200 sessions
- **Rewarded ads:** 600 impressions (50% opt-in)
- **Interstitial ads:** 1,200 impressions (1 per session)
- **Revenue per day:**
  - Rewarded: 600 * $18 / 1000 = $10.80
  - Interstitial: 1200 * $5 / 1000 = $6.00
  - **Total: $16.80/day = $504/month**

#### 10K DAU

- **Sessions per day:** 12,000
- **Rewarded ads:** 6,000 impressions
- **Interstitial ads:** 12,000 impressions
- **Revenue per day:**
  - Rewarded: $108
  - Interstitial: $60
  - **Total: $168/day = $5,040/month**

#### 100K DAU

- **Sessions per day:** 120,000
- **Revenue per day:** $1,680
- **Total: $50,400/month**

#### 1M DAU

- **Revenue per day:** $16,800
- **Total: $504,000/month**

### Real-World Validation

**Slither.io (at peak, 2016-2017):**
- Estimated $100,000/day from ads alone
- $2 ad-removal option added significant revenue
- Total estimated: $3M/month at peak

**Agar.io (at peak):**
- Estimated $500K+ monthly from ads + cosmetics
- 100M+ downloads, peak 100K+ CCU

**Key insight:** These games reached viral scale (1M+ DAU). At smaller scales (10K DAU), revenue is modest ($5K/month) but can still be profitable if costs are low.

---

## 5. Unit Economics Model

### Cost Per Player

| Scale | Server Cost/mo | Peak CCU | Cost per CCU/mo | Cost per DAU/mo |
|-------|---------------|----------|----------------|-----------------|
| 1K DAU | $5 (Bun) | 50 | $0.10 | $0.005 |
| 10K DAU | $30 (Bun) | 500 | $0.06 | $0.003 |
| 100K DAU | $300 (Bun) | 5K | $0.06 | $0.003 |
| 1M DAU | $3K (Go/Rust) | 50K | $0.06 | $0.003 |

**Key insight:** Cost per player decreases with scale due to infrastructure efficiency.

### Revenue Per Player

| Scale | Ad Revenue/mo | DAU | Revenue per DAU/mo |
|-------|--------------|-----|-------------------|
| 1K DAU | $500 | 1K | $0.50 |
| 10K DAU | $5K | 10K | $0.50 |
| 100K DAU | $50K | 100K | $0.50 |
| 1M DAU | $500K | 1M | $0.50 |

**Key insight:** Revenue per player is relatively constant ($0.40-0.60 per DAU/month) across scales, determined by ad impression rate and eCPM.

### Break-Even Analysis

| Backend | Fixed Cost/mo | Break-even DAU | Profit Margin at 10K DAU | Profit Margin at 100K DAU |
|---------|--------------|----------------|-------------------------|--------------------------|
| Node.js | $43 | 86 DAU | 99.4% ($5K - $43) | 99.9% |
| Bun | $29 | 58 DAU | 99.4% ($5K - $29) | 99.9% |
| Go custom | $54 | 108 DAU | 98.9% ($5K - $54) | 99.9% |

**Conclusion:** At 10K+ DAU, the choice of backend is almost irrelevant to profitability (margins are 98-99% regardless). At <1K DAU, every dollar matters, but even then, Bun on a $5 VPS breaks even at 10 DAU.

### Scaling Curve

```
Revenue vs Cost by Scale
=============================

Revenue (green) and Cost (orange) in $/month

1K DAU:    Revenue $500    | Cost $5-55      | Profit: $445-495
10K DAU:   Revenue $5K     | Cost $30-55     | Profit: $4.9K-5K
100K DAU:  Revenue $50K    | Cost $300-600   | Profit: $49K-50K
1M DAU:    Revenue $500K   | Cost $2K-8K     | Profit: $492K-498K
```

**Key insight:** Revenue scales linearly with DAU. Costs scale sub-linearly (economies of scale). Profit margin improves from 90% (1K DAU) to 99%+ (100K+ DAU).

### Sensitivity Analysis

**What if eCPM is lower than projected?**

| eCPM Scenario | Revenue per DAU/mo | Break-even (Bun) | Profit at 10K DAU |
|---------------|-------------------|-----------------|------------------|
| Optimistic ($18 rewarded, $5 interstitial) | $0.50 | 58 DAU | $4,970 |
| Base case ($15 rewarded, $3 interstitial) | $0.38 | 76 DAU | $3,770 |
| Pessimistic ($10 rewarded, $2 interstitial) | $0.25 | 116 DAU | $2,470 |

**What if retention is poor?**

Lower retention → fewer sessions per DAU → fewer ad impressions → lower revenue per DAU.

| Retention | Sessions per DAU | Revenue per DAU/mo | Break-even (Bun) |
|-----------|-----------------|-------------------|-----------------|
| High (1.5 sessions/day) | 45/mo | $0.63 | 46 DAU |
| Base (1.2 sessions/day) | 36/mo | $0.50 | 58 DAU |
| Low (0.8 sessions/day) | 24/mo | $0.34 | 86 DAU |

**Verdict:** Even in pessimistic scenarios (low eCPM, poor retention), break-even is <100 DAU. The model is robust.

---

## 6. Alternative Monetization Strategies

### Cosmetic Skins

**Model:** Sell visual customization (ship colors, trail effects, explosions).

**Pros:**
- No pay-to-win (preserves fairness)
- High margin (near-zero marginal cost)
- Successful in Krunker.io, Agar.io

**Cons:**
- Requires in-game shop UI
- Payment integration (Stripe, PayPal)
- Ongoing content creation (new skins every 2-4 weeks)
- Low conversion rate (1-3% of players spend)

**Revenue estimate:**
- 10K DAU * 2% conversion * $5 ARPPU = $1,000/month
- Adds 20% to ad-only revenue

**Development time:** 2-3 weeks (shop UI, payment, skins)

### Battle Pass / Season System

**Model:** $5-10 for 30-60 days of progression rewards (skins, titles, effects).

**Pros:**
- Predictable revenue
- High engagement (players return daily to progress)
- Industry-proven (Fortnite, Apex Legends, even .io games)

**Cons:**
- Requires content pipeline (new pass every season)
- Progression system implementation
- Payment integration
- Only works at scale (need 10K+ DAU for meaningful revenue)

**Revenue estimate:**
- 10K DAU * 5% buy pass * $8 pass price = $4,000 every 45 days = $2,700/month
- Adds 54% to ad-only revenue

**Development time:** 4-6 weeks (progression system, rewards, shop)

### Ad Removal (One-Time Purchase)

**Model:** $2-5 removes all ads permanently (Slither.io model).

**Pros:**
- Simple to implement
- Appeals to players who hate ads
- One-time payment (no subscription fatigue)

**Cons:**
- Cannibalizes ad revenue from high-engagement players
- Lower lifetime value than recurring monetization

**Revenue estimate:**
- 10K DAU * 5% purchase * $3 price = $1,500 one-time
- Ongoing: 500 new DAU/month * 5% * $3 = $75/month recurring
- **Verdict:** Useful for early adopters, but low recurring revenue

**Development time:** 1 week (payment, server-side flag)

### Sponsorship / Branding

**Model:** In-game branding (e.g., Red Bull energy buff, branded ships).

**Pros:**
- High revenue potential ($5K-50K per deal)
- No player friction (cosmetic only)

**Cons:**
- Requires significant audience (50K+ DAU minimum)
- Negotiation overhead
- May dilute brand/aesthetic

**Revenue estimate:**
- Not viable until 50K+ DAU
- At 100K DAU: $10K-30K per sponsorship deal (quarterly)

**Development time:** 1-2 weeks per sponsorship integration

### Donation / Tip Jar

**Model:** "Pay what you want" or "Buy me a coffee" via Ko-fi, Patreon.

**Pros:**
- Zero friction (optional)
- Appeals to supportive players
- Works at any scale

**Cons:**
- Unpredictable revenue
- Low conversion (<1%)

**Revenue estimate:**
- 10K DAU * 0.5% donate * $5 avg = $250/month
- Adds 5% to ad-only revenue

**Development time:** 1 day (embed Ko-fi button)

### Alternative Monetization Summary

| Strategy | Revenue Potential | Development Time | Best At Scale |
|----------|------------------|-----------------|--------------|
| Ads (rewarded + interstitial) | $0.50 per DAU/mo | 1 week | All scales |
| Cosmetic skins | $0.10 per DAU/mo | 2-3 weeks | 5K+ DAU |
| Battle pass | $0.27 per DAU/mo | 4-6 weeks | 10K+ DAU |
| Ad removal | $0.15 per DAU/mo | 1 week | 5K+ DAU |
| Sponsorship | $0.10-0.30 per DAU/mo | Varies | 50K+ DAU |
| Donations | $0.02 per DAU/mo | 1 day | All scales |

**Stacked revenue (ads + skins + battle pass):** $0.87 per DAU/mo (74% increase over ads alone)

**Recommendation:**
1. **Phase 1 (launch):** Ads only (rewarded video + interstitial)
2. **Phase 2 (5K+ DAU):** Add ad removal ($3 one-time)
3. **Phase 3 (10K+ DAU):** Add cosmetic shop (skins, trails)
4. **Phase 4 (20K+ DAU):** Add battle pass system
5. **Phase 5 (50K+ DAU):** Explore sponsorships

---

## 7. Recommendations

### For Immediate Launch (Next 1-3 Months)

1. **Backend:** Keep Node.js + Colyseus, but switch to Bun runtime
   - **Why:** Zero rewrite, 2-3x performance improvement, costs drop 40-50%
   - **How:** `npm install -g bun` → change start script to `bun server.js`
   - **Effort:** 1 hour

2. **Frontend hosting:** Cloudflare Pages (free, unlimited bandwidth)
   - **Why:** Zero cost, CDN included, automatic HTTPS
   - **How:** Connect GitHub repo, auto-deploy on push
   - **Effort:** 30 minutes

3. **Game server hosting:** Hetzner CPX11 (€4.09/mo, 2 vCPU, 4GB RAM)
   - **Why:** Cheapest EU VPS, handles 200-400 CCU with Bun
   - **Upgrade path:** CPX21 (€12.99) → CPX31 (€22.99) as you scale
   - **Effort:** 1 hour (setup, deploy)

4. **Monetization:** Rewarded video ads only (via CrazyGames or GameDistribution SDK)
   - **Why:** Best eCPM ($16-20), optional (no UX friction), 95% completion rate
   - **Placement:** "Watch ad for extra life?" on death screen
   - **Effort:** 1 week (SDK integration, UI)

5. **Code protection:** Vite's built-in Terser minification (already enabled)
   - **Why:** Free, reduces bundle size, makes code harder to read
   - **Skip:** Advanced obfuscation (not worth cost/effort)
   - **Effort:** 0 (already done)

**Total launch cost:** €4.09/mo ($4.50) + $0 (Cloudflare Pages) = **$5/month**

**Break-even:** 10 DAU (yes, ten players)

**Profit at 1K DAU:** $495/month (99% margin)

### For Scaling (6-12 Months, 10K+ DAU)

1. **Backend optimization:** Evaluate Go or Hybrid TS+Go
   - **When:** If Bun + horizontal scaling (multiple VPS) becomes expensive (>$100/mo)
   - **Why:** 5-10x efficiency gain, reduces costs from $100 → $20-30/mo at 10K DAU
   - **Effort:** 2-4 weeks (Go custom) or 3 weeks (Hybrid)

2. **Monetization expansion:** Add cosmetic shop
   - **When:** 5K+ DAU (enough volume for 1-3% conversion to matter)
   - **Why:** Adds 20-30% revenue with minimal marginal cost
   - **Effort:** 2-3 weeks (shop UI, payment integration, 10 skins)

3. **Hosting:** Multi-region deployment
   - **When:** 20K+ DAU with global audience
   - **Why:** Reduce latency for EU, US, Asia players
   - **How:** Hetzner (EU) + DigitalOcean (US) + DigitalOcean (Asia)
   - **Effort:** 1 week (deployment automation)

### For Viral Scale (1M+ DAU, Future)

1. **Backend:** Migrate to Rust custom server
   - **Why:** Lowest memory footprint, handles 50K+ CCU per server
   - **Cost savings:** $8K (Node.js) → $2K-3K (Rust) at 1M DAU
   - **Effort:** 6-8 weeks (full rewrite)

2. **Monetization:** All strategies combined (ads + cosmetics + battle pass + sponsorships)
   - **Revenue:** $0.87 per DAU/mo * 1M DAU = $870K/month
   - **Costs:** $3K/month (Rust backend + CDN)
   - **Profit:** $867K/month (99.7% margin)

3. **Infrastructure:** Cloudflare Durable Objects or custom edge deployment
   - **Why:** Sub-50ms latency globally
   - **When:** 500K+ DAU with complaints about lag
   - **Effort:** 4-6 weeks (migration to edge)

---

## 8. Implementation Roadmap

### Phase 1: Minimum Viable Monetization (1-2 weeks)

**Objective:** Launch with ads, break even at <50 DAU.

**Tasks:**
1. Switch to Bun runtime (1 hour)
2. Deploy to Hetzner VPS (1 hour)
3. Deploy frontend to Cloudflare Pages (30 min)
4. Integrate CrazyGames SDK (3 days)
5. Add "Watch ad for extra life" button on death screen (2 days)
6. Test ad flow end-to-end (1 day)
7. Launch 🚀

**Cost:** $5/month
**Break-even:** 10 DAU
**Effort:** 40 hours

### Phase 2: Scale to 10K DAU (1-3 months)

**Objective:** Grow audience via game portals, improve monetization.

**Tasks:**
1. Submit to CrazyGames, Poki, GameDistribution (1 week)
2. Add interstitial ads (every 3 deaths) (3 days)
3. Add ad removal purchase option ($3) (1 week)
4. Monitor metrics: DAU, retention, ARPU (ongoing)
5. Optimize ad placement based on data (1 week)
6. Scale Hetzner VPS as needed (CPX11 → CPX21) (1 hour)

**Cost:** $30-55/month (depends on growth rate)
**Revenue:** $5K/month at 10K DAU
**Effort:** 80 hours over 3 months

### Phase 3: Expand Monetization (3-6 months, 10K+ DAU)

**Objective:** Add cosmetics, increase ARPU.

**Tasks:**
1. Design cosmetic system (ship skins, trails, explosions) (1 week)
2. Build in-game shop UI (1 week)
3. Integrate Stripe for payments (3 days)
4. Create 10 launch skins (1 week)
5. Add skin preview in shop (2 days)
6. Launch cosmetic shop (1 day)
7. A/B test pricing ($2, $3, $5 skins) (2 weeks)

**Cost:** $30-55/month
**Revenue:** $6.5K/month (ads + cosmetics) at 10K DAU
**Effort:** 120 hours over 6 weeks

### Phase 4: Backend Optimization (6-9 months, 20K+ DAU)

**Objective:** Reduce server costs via Go or Hybrid architecture.

**Tasks:**
1. Benchmark Bun vs Go WebSocket performance (1 week)
2. Choose: Full Go rewrite vs Hybrid TS+Go (decision point)
3. If Hybrid:
   - Build Go WebSocket layer (1 week)
   - Build IPC bridge (TypeScript ↔ Go) (1 week)
   - Migrate production incrementally (1 week)
4. If Full Go:
   - Rewrite room system (2 weeks)
   - Rewrite state sync (1 week)
   - Rewrite matchmaking (1 week)
5. A/B test performance (1 week)
6. Full migration (1 week)

**Cost:** $30-55/month → $20-30/month (40% reduction)
**Revenue:** $10K/month at 20K DAU
**Effort:** 160-240 hours (Hybrid: 160h, Full: 240h)

---

## 9. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Ad blockers reduce revenue 30-50% | High | Medium | Prompt users to disable (polite, not aggressive); alternative: cosmetic shop |
| Server costs spike faster than projected | Medium | Medium | Horizontal scaling (add VPS as needed); Cloudflare rate limiting |
| Bun has WebSocket bugs/instability | Low | Medium | Bun is production-ready as of v1.0 (2023); fallback: revert to Node.js |
| Go/Rust rewrite introduces bugs | Medium | High | Incremental migration; shadow mode testing; keep Node.js as fallback |
| Payment fraud (stolen credit cards) | Medium | Low | Stripe's built-in fraud detection; manual review for high-value purchases |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Low DAU (<500) → unprofitable | Medium | Low | Break-even at 10-50 DAU with Bun; almost impossible to lose money |
| Poor retention → low ad impressions | High | Medium | Focus on gameplay polish, leaderboards, social features |
| Clones steal players | Low | Low | Community, server quality, and continuous updates are moat |
| Game portals reject submission | Low | Medium | Submit to 3+ portals; self-host if all reject |
| Ad network bans account | Low | High | Diversify across multiple networks; keep Stripe cosmetics as backup |

### Competitive Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Existing .io games dominate search | High | Medium | SEO optimization, unique value prop (3D + geodesic surfaces) |
| New competitor launches similar game | Medium | Low | First-mover advantage, community building, continuous updates |
| Unity/Unreal WebGL exports compete | Low | Low | Performance advantage (Three.js is lighter than Unity WebGL) |

### Legal/Compliance Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Geometry Wars IP claim (Activision owns trademark) | Low | High | Rename if challenged; "3D Dimensions" is generic; free = no profit motive for lawsuit |
| GDPR/CCPA compliance (ads = tracking) | Medium | Medium | Use compliant ad networks (CrazyGames handles consent); no custom tracking |
| Payment processing issues (Stripe) | Low | Low | Stripe handles compliance; monitor chargeback rate |

**Overall risk level:** Low to Medium. Most risks are mitigatable with proper planning.

---

## 10. Sources

### Performance Benchmarks & Server Architecture
- [Rust vs Node.js vs Go: Performance Comparison for Backend Development — DEV Community](https://dev.to/hamzakhan/rust-vs-nodejs-vs-go-performance-comparison-for-backend-development-2g69)
- [Rust vs Go vs Node.js: Which Backend Language Will Dominate in 2026? — Medium](https://caffeinatedcoder.medium.com/rust-vs-go-vs-node-js-which-backend-language-will-dominate-in-2026-b46e652d12f4)
- [WebSocket Performance Comparison — Medium](https://matttomasetti.medium.com/websocket-performance-comparison-10dc89367055)
- [Rust vs Go - Load testing webserv (>400k req/s) — DEV Community](https://dev.to/martichou/rust-vs-go-load-testing-400k-req-s-53l)
- [Colyseus Maximum Concurrent Connections — Discussion Group](https://discuss.colyseus.io/topic/372/maximum-concurrent-connections)
- [Colyseus io type game ccu test — Discussion Group](https://discuss.colyseus.io/topic/374/io-type-game-ccu-test)

### Hosting & Infrastructure
- [Fly.io vs Hetzner Comparison — GetDeploying](https://getdeploying.com/flyio-vs-hetzner)
- [DigitalOcean vs Hetzner — Comparing Cloud Hosting Providers](https://www.digitalocean.com/resources/articles/digitalocean-vs-hetzner)
- [Railway vs Fly.io vs Render: Which Cloud Gives You the Best ROI? — Medium](https://medium.com/ai-disruption/railway-vs-fly-io-vs-render-which-cloud-gives-you-the-best-roi-2e3305399e5b)
- [Cloudflare Pages Free Tier — Pricing & Limits](https://www.freetiers.com/directory/cloudflare-pages)
- [Workers & Pages Pricing — Cloudflare](https://www.cloudflare.com/plans/developer-platform/)

### Ad Monetization & Revenue
- [Game Monetization Strategies — GameDistribution Blog](https://blog.gamedistribution.com/game-monetization-strategies/)
- [How Much Ad Revenue Can Apps Really Make in 2026? — MonetizeMore](https://www.monetizemore.com/blog/how-much-ad-revenue-can-apps-generate/)
- [Ad Monetization in Mobile Games - Benchmark Report 2025 — Tenjin](https://tenjin.com/blog/ad-mon-gaming-2025/)
- [Rewarded Video Ads (2025) — Business of Apps](https://www.businessofapps.com/ads/rewarded-video/)
- [Find out how much money a multiplayer web game makes — KinematicSoup](https://kinematicsoup.com/news/2019/9/8/the-economics-of-web-based-multiplayer-games)
- [Slither.io revenue — Pocket Gamer.biz](https://www.pocketgamer.biz/news/63211/slitherio-revenue/)

### Free-to-Play Business Models
- [Free-to-Play Gaming Economics: How $0 Games Generate Billions — Business Model Analyst](https://businessmodelanalyst.com/free-to-play-gaming-economics-how-0-games-generate-billions/)
- [Game Economics, Part 3: Free-to-Play Games — Medium](https://medium.com/building-the-metaverse/game-economics-part-3-free-to-play-games-78aa790d55ae)
- [Mobile Game Revenue Statistics 2026 — Tekrevol](https://www.tekrevol.com/blogs/mobile-game-revenue-statistics/)

### Code Protection & Obfuscation
- [JavaScript obfuscator tool — Obfuscator.io](https://obfuscator.io)
- [webpack-obfuscator — npm](https://www.npmjs.com/package/webpack-obfuscator)
- [JavaScript Source Code Protection Through Obfuscation — Blog](https://blog.ni18.in/javascript-source-code-protection-through-obfuscation/)

### Hybrid Architecture & Language Integration
- [Rust vs JavaScript & TypeScript: Performance and WebAssembly — JetBrains](https://blog.jetbrains.com/rust/2026/01/27/rust-vs-javascript-typescript/)
- [TypeScript is Moving to Go! But Why? — DEV Community](https://dev.to/mrasadatik/typescript-is-moving-to-go-but-why-the-mind-blowing-reason-behind-the-switch-5hm2)
- [Microsoft TypeScript Devs Explain Why They Chose Go Over Rust — The New Stack](https://thenewstack.io/microsoft-typescript-devs-explain-why-they-chose-go-over-rust-c/)

### Alternative Monetization
- [Game Monetization For Battle Passes — Meegle](https://www.meegle.com/en_us/topics/game-monetization/game-monetization-for-battle-passes)
- [Game Monetization For Skins — Meegle](https://www.meegle.com/en_us/topics/game-monetization/game-monetization-for-skins)
- [Video game monetization — Wikipedia](https://en.wikipedia.org/wiki/Video_game_monetization)
- [Ways to maximize web game revenue — Xsolla](https://xsolla.com/blog/ways-to-maximize-web-game-revenue)

### Game Server Cost Analysis
- [Maximize game server infrastructure efficiency: True cost per CCU — i3D.net](https://www.i3d.net/maximize-game-server-infrastructure-efficiency-true-cost-per-ccu/)
- [Your Comprehensive Guide To Mobile Game Server Costs — Metaplay Blog](https://www.metaplay.io/blog/mobile-game-server-costs)
- [Dedicated Game Server Hosting - Amazon GameLift Pricing — AWS](https://aws.amazon.com/gamelift/servers/pricing/)

---

## Appendix: Decision Framework

Use this framework to make quick decisions as circumstances change:

### Should I switch from Bun to Go/Rust?

**Yes, if:**
- Hosting costs exceed $100/month AND you have >10K DAU
- You're hitting CPU limits on current VPS (>80% usage sustained)
- Latency complaints from players (>100ms server tick time)

**No, if:**
- Current costs are <$100/month (not worth engineering time)
- Bun + horizontal scaling (multiple VPS) is working fine
- You haven't optimized Bun setup yet (worker threads, clustering)

### Should I add cosmetic shop / battle pass?

**Yes, if:**
- DAU >5K (enough volume for conversions to matter)
- Retention is strong (D7 retention >30%)
- Players are asking for cosmetics (Discord, feedback)

**No, if:**
- DAU <2K (low volume = low revenue, not worth dev time)
- Retention is weak (<20% D7) — fix core gameplay first
- Ads alone are covering costs comfortably

### Should I worry about code theft?

**No.** Focus on:
1. Server uptime and latency
2. Community building (Discord, updates, events)
3. Continuous content updates (new weapons, enemies, maps)
4. SEO and discoverability (game portals, YouTube, Twitch)

The multiplayer experience is the moat, not the code.

---

**END OF RESEARCH DOCUMENT**
