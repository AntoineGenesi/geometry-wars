# Distribution Channels Analysis

**Date:** 2026-02-10
**Status:** Strategic research — no code references, remains relevant.

## 1. Browser-First (Primary Launch Channel)

### Direct Web (Own Domain)
- **Cost:** Domain ($12/yr) + hosting ($5-20/mo)
- **Revenue Share:** 100% (minus payment processing ~2.9%)
- **Reach:** Organic only unless marketed
- **Pros:** Full control, direct player relationship, instant play
- **Cons:** No built-in discovery, must drive all traffic yourself
- **Monetization:** Ads (CPM $1-5), premium unlock, cosmetics, battle pass
- **Best For:** Core loyal players, direct community

### Poki
- **Monthly Players:** 100M+ worldwide (as of 2025), 1B plays/month
- **Revenue Share:** Not publicly disclosed; varies by exclusivity terms
- **Acceptance:** Selective — quality bar is high
- **Revenue Potential:** Top studios earning up to $1M/year (Dutch Games Association 2024 report)
- **Pros:** Massive built-in audience, handles monetization (ads), no upfront cost
- **Cons:** Selective acceptance, limited player data access, ad-only monetization
- **Best For:** Maximum reach, casual audience, ad revenue

### CrazyGames
- **Monthly Players:** ~38M (est. ~2.6x smaller than Poki)
- **Revenue Share:** Base rate undisclosed; +50% bonus for SDK integration + 2-month exclusivity
- **Recent:** Partnered with Xsolla for in-app purchases (2024)
- **Pros:** Less selective than Poki, SDK ads integration, IAP now possible
- **Cons:** Smaller audience, revenue share not transparent
- **Best For:** Secondary browser platform, broader reach

### itch.io
- **Total Products:** 1M+ hosted
- **Revenue Share:** Developer sets it (default 10%, can be 0%)
- **Payment Processing:** Standard fees apply on top
- **Creator Day:** Periodic events where itch.io takes 0%
- **Pros:** Maximum developer control, browser games supported, community-friendly
- **Cons:** Low discoverability, niche audience, modest revenue potential
- **Best For:** Community building, early access, name-your-price model

### Newgrounds
- **Audience:** Legacy but loyal, strong nostalgia community
- **Revenue:** Ad-supported, revenue share with creators
- **Pros:** Cult following, browser game heritage, supportive community
- **Cons:** Smaller audience than Poki/CrazyGames, aging platform
- **Best For:** Building credibility in browser game community

---

## 2. Steam (PC)

### Requirements & Costs
- **Publishing Fee:** $100 per game (recoupable after $1,000 revenue)
- **Revenue Split:** 70/30 (developer/Valve), improving to 75/25 at $10M, 80/20 at $50M
- **Review Period:** 1-5 days for store page, 30-day minimum before release
- **Store Page Setup:** Screenshots, description, system requirements, trailer

### Technical Path (Browser Game to Steam)
- **Electron:** Wrap web app in Chromium. Full Steamworks integration via `steamworks.js` or `greenworks` npm packages. Most proven path.
- **NW.js:** Alternative to Electron, slightly smaller footprint. Also supports Steamworks via greenworks.
- **Tauri:** Lighter weight but uses OS WebView (not Chromium) — WebGL performance issues reported on some platforms. Not recommended for graphics-heavy games.
- **Notable Precedent:** Vampire Survivors was built with Phaser (browser engine) and distributed on Steam via this exact approach.

### Steam Discovery
- **Steam Next Fest:** 3x per year (Feb, Jun, Oct). Free demo event. Massive visibility. Can only participate ONCE per game. February 2026 edition: Feb 23 - Mar 2.
- **Wishlists:** Median conversion rate ~15% of wishlists to first-week sales (2024-2025 data). Target 10K+ wishlists before launch.
- **Tags:** "Twin Stick Shooter" tag has ~1,922 games on Steam. Niche enough for discovery, large enough for audience.

### Revenue Potential
- Steam indie revenue in 2025: $4.5B total (25% of Steam's $17.7B)
- Distribution is extremely top-heavy: top 0.5% of indie games account for most revenue
- Median indie game revenue on Steam: very low (sub-$10K)
- But twin-stick shooters with strong reviews perform well above median

---

## 3. Mobile

### PWA (Progressive Web App)
- **Cost:** $0 additional development
- **Distribution:** Direct URL sharing, add-to-homescreen
- **Performance:** Three.js on mobile WebGL is viable but requires optimization (LOD, reduced particles)
- **Pros:** No app store fees, instant updates, cross-platform
- **Cons:** No app store discovery, limited iOS PWA support, performance constraints
- **Best For:** Casual mobile players, sharing viral loops

### Capacitor (Native Wrapper)
- **What:** Wraps web app in native iOS/Android shell
- **Cost:** Apple Developer ($99/yr), Google Play ($25 one-time)
- **Revenue Split:** 70/30 (App Store/Google Play take 30%, 15% for small developers <$1M)
- **Pros:** Full app store distribution, push notifications, native APIs
- **Cons:** App store review process, 30% cut, needs mobile-specific UI optimization
- **Performance:** WebGL rendering via native WebView, reasonable for 2D-style 3D

### Revenue Model on Mobile
- **F2P + Ads:** Most common for arcade games. $1-5 RPM. Daily active user monetization.
- **Premium:** $2.99-4.99. Works for established brands. Hard to compete with free.
- **Hybrid:** Free base game, remove ads for $2.99, cosmetic IAP

---

## 4. Console

### Nintendo Switch (Best Indie Console)
- **Dev Kit Cost:** ~$600 (may vary)
- **Certification:** $4K-10K per submission
- **Registration:** Free via developer.nintendo.com, individual or company
- **Process:** Register -> Get approved -> Receive dev kit -> Develop -> Submit for testing -> Age rating -> Publish
- **Revenue Split:** 70/30 (developer/Nintendo)
- **Why Best for Indie:** Most indie-friendly console maker, large install base of indie-buying audience, Nintendo actively courts indie developers
- **Technical Challenge:** Cannot run web tech natively. Would need to port to Unity/Godot or use a custom solution. nx.js exists as homebrew runtime but not for commercial distribution.

### Xbox (ID@Xbox)
- **Dev Kit Cost:** Free (2 dev kits provided)
- **Certification Fee:** Included in program
- **Registration:** Free via xbox.com/publish
- **Revenue Split:** 70/30
- **Why Good:** Free dev kits, no upfront cost, cross-platform with PC (Game Pass potential)
- **Technical Path:** Could potentially use Electron-based approach for Xbox if approved through ID@Xbox, though native port is more reliable

### PlayStation (PlayStation Partners)
- **Dev Kit Cost:** Free loan of 1 dev kit + 1 test kit for approved developers (must return within 2 years)
- **Certification:** $5K-10K per submission
- **Registration:** Free via partners.playstation.net
- **Revenue Split:** 70/30
- **Challenge:** Most selective platform, highest certification bar

### Console Porting Feasibility for a Three.js Game
- **Direct Port:** NOT feasible. Consoles don't run browsers natively for commercial games.
- **Recommended Path:** Rebuild rendering layer using Unity, Godot, or a native framework while keeping game logic (TypeScript can compile to C# or be rewritten).
- **Alternative:** Use Cocos Creator, which supports both web and Switch deployment
- **Cost Estimate:** $20K-80K for a console port depending on approach
- **Timeline:** 3-6 months with experienced port developer
- **Priority:** Ship browser + Steam first. Console port only if revenue justifies investment.

---

## 5. Desktop (Non-Steam)

### Epic Games Store
- **Revenue Split:** 88/12 (developer-favorable)
- **Cost:** Free to publish
- **Audience:** Smaller than Steam for indie games, but better revenue share
- **Technical:** Same Electron wrapper as Steam

### GOG
- **Revenue Split:** 70/30
- **Audience:** DRM-free enthusiasts, smaller indie audience
- **Best For:** Long-tail sales, DRM-free credibility

---

## Recommended Distribution Strategy (Phased)

### Phase 1: Browser Launch (Month 0)
- Launch on own website (free-to-play, ad-supported)
- Submit to Poki and CrazyGames simultaneously
- Post on itch.io (name-your-price)
- Post on Newgrounds
- Goal: Validate product-market fit, gather feedback, build community

### Phase 2: Steam Launch (Month 2-4)
- Electron wrapper with Steamworks integration
- Steam Next Fest demo participation
- Premium pricing: $4.99 (proven sweet spot)
- Browser version remains free (drives wishlists)

### Phase 3: Mobile (Month 4-6)
- PWA for Android first (better WebGL support)
- Capacitor wrapper for App Store if metrics warrant
- F2P + ads + premium unlock

### Phase 4: Console (Month 12+, revenue-dependent)
- Switch first (best indie audience)
- Only if Steam revenue exceeds $100K
- Budget $30-50K for port
