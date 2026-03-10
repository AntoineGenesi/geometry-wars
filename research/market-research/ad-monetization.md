# Ad Monetization Research: .io Game Models, Hosting Costs, Unit Economics

**Date:** 2026-02-11
**Status:** Strategic research — no code references, remains relevant.

## How .io Games Make Money

### agar.io
- **Model:** Free-to-play with ads + in-game currency + XP progression
- **Revenue:** One of the top 200 most profitable games; hundreds of thousands per month at peak
- **Ads:** Pre-roll video ads, banner ads in menu system, interstitial ads between games
- **IAP:** Cosmetic skins, XP boosts via in-game currency
- **Key insight:** Added full F2P meta-game layer (XP, currency) beyond just ads
- **Source:** gameslearningsociety.org, splicedonline.com

### slither.io
- **Model:** Free-to-play with ads + $3.99 ad removal option
- **Revenue:** ~$100,000/day at peak from advertising alone
- **Ads:** In-game ads with option to pay $3.99 to remove them
- **Downloads:** 75M+ on iOS/Android combined
- **Key insight:** Developer Steve Howse avoided AWS due to bandwidth costs; spent $15K/month on dedicated servers at peak
- **Infrastructure challenge:** Each server needed to handle 600 concurrent players; most difficult part was stability at scale
- **Source:** PocketGamer.biz, Digital Trends, Tech.co

### krunker.io
- **Model:** Free-to-play with cosmetics marketplace + premium subscription + ads
- **Revenue streams:**
  - **Krunkies (KR):** In-game currency earned through play or purchased
  - **Krunker Premium:** 7,500 KR/month — golden badge, custom avatars, 16-player rooms
  - **Skin Marketplace:** Player-to-player trading with 10% listing fee (marketplace tax)
  - **Loot Cases/Spins:** Randomized cosmetic rewards
  - **Ads:** Display ads for non-premium players
- **Traffic:** ~4.1M monthly visits (SimilarWeb, Oct 2025)
- **Key insight:** Most sophisticated monetization of any .io game — combines ads, cosmetics, marketplace fees, and subscriptions
- **Source:** Krunker Wiki (Fandom), SimilarWeb

### surviv.io (acquired by Kongregate)
- **Model:** Free-to-play with ads + battle pass + cosmetics
- **Acquired by:** Kongregate (2020) — validated that .io games have acquisition value
- **Key insight:** Even mid-tier .io games have enough value for acquisition

---

## Ad Networks for Browser Games

| Network | Revenue Model | CPM Range | Notes |
|---------|--------------|-----------|-------|
| **Google AdSense** | Display/video ads | $1-5 RPMI (web) | Easiest to implement, lowest rates |
| **GameDistribution** | Pre-roll + display | $2-6 RPMI | Games-specific network, 4K+ games |
| **Poki** | Revenue share (50/50 or 100/0) | Undisclosed | 50/50 if Poki brings traffic; 100% if dev brings traffic |
| **CrazyGames** | Revenue share + SDK bonus | Undisclosed (+50% bonus) | +50% for SDK integration + 2-month exclusivity |
| **Iron Source / Unity Ads** | Rewarded video | $5-15 eCPM (rewarded) | Higher CPM for rewarded video format |
| **AdMob (mobile web)** | Various formats | $0.60 banner, $10-15 rewarded video | Mobile web rates higher than desktop |

**Key metrics:**
- Desktop web banner ads: $1-5 CPM
- Rewarded video ads: $5-15 eCPM (much higher)
- Pre-roll video ads: $3-8 CPM
- Interstitial ads: $4-10 CPM

**Source:** Genieee.com HTML5 Monetization Guide 2025, Gamigion Benchmark Report 2025

---

## Hosting Costs at Different Scales

### Budget Hosting (Hetzner / Vultr / DigitalOcean)

| Provider | Cheapest Plan | Included Traffic | Best For |
|----------|--------------|-----------------|----------|
| **Hetzner** | EUR 3.49/mo (CX23) | 20 TB | EU-based, cheapest option |
| **Vultr** | $5/mo (1 vCPU) | 1 TB | Global regions |
| **DigitalOcean** | $4/mo (Basic) | 500 GB | Developer-friendly |
| **Linode** | $5/mo (1 vCPU) | 1 TB | Good Node.js support |

### Estimated Hosting Costs by Concurrent Player Count

Assumptions: Colyseus WebSocket server, ~14KB/s per player, 4-player rooms

| CCU | Server Needs | Monthly Cost (Budget) | Monthly Cost (AWS) | Notes |
|-----|-------------|----------------------|-------------------|-------|
| **100** | 1x small VPS | $5-15/mo | $20-40/mo | Single Hetzner CX23 handles this |
| **1,000** | 2-3x medium VPS | $30-80/mo | $100-250/mo | Need horizontal scaling + Redis |
| **10,000** | 8-15x VPS + Redis + CDN | $300-800/mo | $2,000-5,000/mo | Dedicated server cluster |
| **100,000** | 100+ VPS + load balancer + Redis cluster | $3,000-8,000/mo | $20,000-50,000/mo | Enterprise infrastructure |

**Bandwidth is the biggest cost:**
- ~14 KB/s per player = ~36 GB/month per MACCU (monthly averaged concurrent user)
- At $0.01-0.12/GB depending on provider
- Hetzner includes 20 TB free = ~550 MACCU before bandwidth charges
- AWS charges $0.09/GB after free tier = $3.24/month per MACCU

**slither.io precedent:** Developer spent $15,000/month on dedicated servers during peak, avoided AWS to maintain profitability despite $100K/day in ad revenue.

**Colyseus capacity:** A single process handles ~1,024 connections by default (Linux file descriptor limit). With tuning, up to 3,500 connections per process. Each room belongs to one process.

**Source:** KinematicSoup Economics Article, Hetzner pricing, AWS pricing, Colyseus FAQ

---

## Unit Economics: Cost per User vs Revenue per User

### Cost Side

| Component | Cost per MACCU/month | Notes |
|-----------|---------------------|-------|
| Server compute | $0.01-0.05 | Cheap on budget providers |
| Bandwidth | $0.50-4.00 | Biggest variable; depends on game data rate |
| CDN / asset delivery | $0.10-0.50 | Initial game load (~5-10 MB) |
| Redis / database | $0.01-0.10 | Shared across users |
| **Total** | **$0.62-4.65** | Lower for optimized games, higher for action games |

### Revenue Side

| Source | Revenue per MACCU/month | Notes |
|--------|------------------------|-------|
| Display ads (banner) | $0.50-2.50 | At $1-5 CPM, ~500-1000 impressions/user/month |
| Pre-roll video ads | $1.00-4.00 | 1-3 pre-rolls per session, $3-8 CPM |
| Rewarded video ads | $2.00-8.00 | Opt-in, $5-15 eCPM, highest value |
| In-game purchases | $0.10-1.00 | Low conversion (~2-5% of players buy), high value per buyer |
| Ad removal purchase | $0.05-0.30 | One-time, amortized over player lifetime |
| **Total (ads only)** | **$1.50-6.50** | Varies by engagement and ad format mix |
| **Total (ads + IAP)** | **$1.65-7.80** | Cosmetics/premium add meaningful revenue |

### Real-World Data Point
KinematicSoup case study: 150K monthly users, ~100 MACCU
- Revenue: $1,128.47/month ($0.007/MAU, ~$11.28/MACCU)
- Costs: ~60% of revenue ($677) — $100 servers + bandwidth
- **Net profit: ~$450/month at 150K MAU**
- **Breakeven: ~90K MAU at their efficiency**

---

## Break-Even Analysis for This Project

### Scenario A: Ad-Supported Browser Game Only (Budget Hosting)

**Assumptions:**
- Hetzner hosting (EUR 3.49/mo base + scaling)
- Mixed ad formats (pre-roll + rewarded video + banner)
- Average $3-4 RPMI across all formats
- 4-player Colyseus rooms
- ~14 KB/s per player bandwidth

| MAU | Estimated CCU | Hosting Cost | Ad Revenue | Net |
|-----|--------------|-------------|------------|-----|
| 1,000 | ~10 | $5/mo | $5-15/mo | $0-10/mo |
| 10,000 | ~100 | $15-30/mo | $50-150/mo | $20-120/mo |
| 50,000 | ~500 | $80-200/mo | $250-750/mo | $170-550/mo |
| 100,000 | ~1,000 | $200-500/mo | $500-1,500/mo | $300-1,000/mo |
| 500,000 | ~5,000 | $800-2,000/mo | $2,500-7,500/mo | $1,700-5,500/mo |
| 1,000,000 | ~10,000 | $2,000-5,000/mo | $5,000-15,000/mo | $3,000-10,000/mo |

**Break-even point: ~5,000-10,000 MAU** (when ad revenue exceeds hosting costs)

### Scenario B: Hybrid Model (Browser Ads + Steam Premium)

This is the recommended approach: free browser version with ads drives traffic to $4.99-7.99 Steam version without ads.

| Revenue Stream | Monthly at 100K MAU | Annual |
|---------------|-------------------|--------|
| Browser ads | $500-1,500 | $6,000-18,000 |
| Steam conversions (0.5-2% of MAU) | 500-2,000 sales = $1,750-7,000 | $21,000-84,000 |
| **Total** | **$2,250-8,500** | **$27,000-102,000** |
| Hosting costs | $200-500 | $2,400-6,000 |
| **Net profit** | **$1,750-8,000** | **$24,600-96,000** |

---

## Hybrid Monetization: Free Browser + Premium Steam

### How It Works
1. **Browser version:** Free, ad-supported, full game. Multiplayer included.
2. **Steam version:** $4.99-7.99, NO ads, exclusive features (offline mode, Steam achievements, workshop support, enhanced graphics).
3. **Conversion funnel:** Browser players see "Get the premium experience on Steam" prompts.

### Examples of This Model Working
- **Vampire Survivors:** Built in Phaser (web engine), sold on Steam as Electron wrapper. Free mobile version came later.
- **Krunker.io:** Free browser game with optional Steam version ($0 but with marketplace integration).
- **Shell Shockers:** Free browser on CrazyGames/Poki, also on Steam.

### Why Players Pay for Steam Despite Free Browser Version
1. **Offline play** — no server dependency
2. **Steam achievements & trading cards** — collectible value
3. **No ads** — ad-free experience
4. **Workshop / mod support** — community content
5. **Better performance** — Electron has fewer browser overhead limitations
6. **Social proof** — Steam library, hours played visible to friends
7. **Sale discoverability** — Steam seasonal sales drive impulse buys

### Differentiation Strategy (Critical for Avoiding Cannibalization)
- **Browser:** Core game, ads, no leaderboard persistence, limited save data
- **Steam:** No ads, persistent leaderboards, Steam Cloud saves, exclusive game modes, custom keybinds, replay system
- **The 80/20 rule:** Browser version is 80% of the experience. Steam is the "definitive edition."

---

## Recommendation for This Project

### Primary Strategy: Hybrid Browser + Steam
1. Launch browser version first on own site + Poki + CrazyGames
2. Monetize with pre-roll + rewarded video ads (highest CPM)
3. Use browser player base to drive Steam wishlists
4. Price Steam at $7.99 (not $4.99 — see Peak pricing psychology)
5. Steam version: no ads, exclusive features, Steam integration

### Why This Works for a Twin-Stick Shooter
- **Zero-friction try:** Players click a link and play instantly
- **Natural upsell:** "Want this without ads + with Steam achievements?"
- **Multiplayer as retention:** Friends share browser links, driving viral growth
- **Low hosting costs:** 4-player rooms are lightweight vs. 100-player battle royale

### Hosting Recommendation
- **Start:** Single Hetzner CX23 (EUR 3.49/mo) — handles 100+ CCU
- **Scale:** Add Hetzner VPS instances horizontally with Redis
- **At 10K CCU:** ~$300-800/mo on Hetzner vs. $2,000-5,000 on AWS
- **Avoid AWS unless at 50K+ CCU** where managed services justify cost

### Expected Revenue at Maturity (12 months post-launch)
| Metric | Conservative | Moderate | Optimistic |
|--------|-------------|----------|-----------|
| MAU | 10K | 100K | 500K |
| Browser ad revenue/mo | $50-150 | $500-1,500 | $2,500-7,500 |
| Steam conversions/mo | 50-100 | 500-2,000 | 2,500-10,000 |
| Steam revenue/mo | $175-350 | $1,750-7,000 | $8,750-35,000 |
| Hosting cost/mo | $5-15 | $200-500 | $800-2,000 |
| **Net monthly** | **$205-485** | **$2,050-8,000** | **$10,450-40,500** |
| **Net annual** | **$2,460-5,820** | **$24,600-96,000** | **$125,400-486,000** |
