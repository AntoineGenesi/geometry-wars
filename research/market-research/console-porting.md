# Console Porting Feasibility Assessment

**Date:** 2026-02-10
**Status:** Strategic research — no code references, remains relevant.

## Core Question
Can a Three.js / TypeScript browser game be commercially deployed on consoles (Switch, Xbox, PlayStation)?

**Short Answer:** Not directly. But there are viable paths with varying cost and complexity.

---

## Technical Reality

### What Consoles Can Run
- Consoles run native binaries (C/C++, C#, Rust)
- No console has a commercial-grade browser runtime for game distribution
- WebGL/JavaScript cannot run natively on any console's retail hardware

### What Exists Today
- **nx.js:** A JavaScript runtime for Nintendo Switch *homebrew* applications. Implements Canvas API, fetch(), etc. NOT for commercial distribution — only for homebrew/development experimentation.
- **Cocos Creator:** Supports both web and Nintendo Switch targets. If the game were rebuilt in Cocos, it could target both platforms natively.
- **Unity WebGL export -> Native:** Unity can import web concepts and deploy to all consoles, but this requires a rewrite.

---

## Porting Options (Ranked by Feasibility)

### Option 1: Rewrite in a Cross-Platform Engine (Recommended)
- **Target Engine:** Unity (C#), Godot (GDScript/C#), or Unreal (C++)
- **What Transfers:** Game design, level data, balance numbers, art assets, audio
- **What Gets Rewritten:** Renderer, input system, physics integration, networking
- **Cost:** $30,000-80,000 (outsourced port developer) or 3-6 months (in-house)
- **Pros:** Highest quality result, all consoles supported, best performance
- **Cons:** Highest cost, longest timeline, two codebases to maintain
- **Who Does This:** Specialized porting houses (e.g., BlitWorks, Abstraction Games, Stage Clear Studios)

### Option 2: Hybrid Approach — Share Game Logic
- **Concept:** Keep TypeScript game logic, replace Three.js renderer with native graphics
- **How:** Compile TypeScript to C# (manual port) or use a JS engine embedded in native code
- **Libraries:** QuickJS (embedded JS engine) could theoretically run game logic on console with a native renderer
- **Cost:** $20,000-50,000
- **Pros:** Preserves core game logic, moderate cost
- **Cons:** Still significant work, untested approach for commercial console games
- **Risk Level:** Medium-High (novel approach, limited precedents)

### Option 3: Xbox via UWP/Electron (Experimental)
- **Concept:** Xbox supports UWP apps, and there are experimental paths for web-based UWP apps
- **Reality:** Microsoft's stance on web-wrapped games for Xbox retail is unclear
- **ID@Xbox has approved web-tech games before** but this is not a guaranteed path
- **Cost:** $5,000-15,000 if it works
- **Pros:** Lowest cost, closest to existing codebase
- **Cons:** Uncertain approval, possible performance issues, Xbox-only
- **Recommendation:** Worth exploring with Microsoft directly through ID@Xbox program

---

## Console-by-Console Assessment

### Nintendo Switch / Switch 2
- **Dev Kit:** ~$600
- **Certification:** $4,000-10,000 per submission
- **Registration:** Free, individual or company
- **Indie-Friendliness:** Excellent. Most indie-friendly console.
- **Technical Path:** Must use Unity, Godot, or native C++ (no web runtime for commercial games)
- **Audience:** Perfect overlap with twin-stick shooter fans. Switch owners buy indie games.
- **Recommendation:** Top console target if porting. Prioritize after Steam success proves demand.

### Xbox Series X|S / Xbox One
- **Dev Kit:** Free (2 provided through ID@Xbox)
- **Certification:** Free through program
- **Registration:** Free via xbox.com/publish
- **Indie-Friendliness:** Very good. Free dev kits and no fees are compelling.
- **Technical Path:** Unity/Godot port, or explore UWP/Electron experimental path
- **Audience:** Good, especially with Game Pass potential
- **Game Pass Opportunity:** Microsoft actively acquires indie titles for Game Pass. Guaranteed revenue regardless of sales.
- **Recommendation:** Second console target. Free entry makes it low-risk to explore.

### PlayStation 5 / PS4
- **Dev Kit:** Free loan (1 dev kit + 1 test kit, must return within 2 years)
- **Certification:** $5,000-10,000 per submission
- **Registration:** Free via partners.playstation.net
- **Indie-Friendliness:** Least friendly of the three. More selective, higher cert costs.
- **Technical Path:** Unity/Godot port only (no experimental web paths)
- **Audience:** Large but less indie-focused than Switch
- **Recommendation:** Third priority. Only pursue if Switch + Xbox generate meaningful revenue.

---

## Cost Summary

| Platform | Entry Cost | Port Cost | Cert Cost | Total Estimate |
|----------|-----------|-----------|-----------|----------------|
| Switch | $600 (dev kit) | $30-50K | $5-10K | $36-61K |
| Xbox | $0 | $25-45K | $0 | $25-45K |
| PlayStation | $0 (loan) | $30-50K | $5-10K | $35-60K |
| All Three | $600 | $50-80K (shared codebase) | $10-20K | $61-101K |

**Note:** If using Unity or Godot for the port, the same codebase targets all three consoles. The incremental cost for each additional platform after the first is much lower (~$5-15K for platform-specific QA and certification).

---

## Recommendation

### Do Not Port to Console Until:
1. Browser + Steam version has generated $50K+ in revenue
2. Community demand for console version is demonstrated (people asking for it)
3. You have budget allocated ($30-60K minimum)
4. Steam version has 500+ reviews with "Very Positive" rating

### When Ready to Port:
1. **Choose Unity** as the target engine (largest console support, most porting talent available)
2. **Start with Switch** (best indie audience, reasonable cert costs)
3. **Use the same Unity build for Xbox** (incremental cost ~$5-10K)
4. **PlayStation last** (highest friction, least benefit for small studios)
5. **Consider a porting studio** rather than doing it in-house (BlitWorks, Abstraction Games specialize in this)

### Alternative: Xbox Cloud Gaming
- Microsoft has explored web-based games through xCloud / Xbox Cloud Gaming
- If your game runs in a browser, it could theoretically run on xCloud
- This is a future bet, not a current distribution channel
- Worth monitoring Microsoft's stance on browser-native cloud games
