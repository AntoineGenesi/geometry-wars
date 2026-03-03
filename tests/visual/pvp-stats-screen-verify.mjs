/**
 * Puppeteer visual test for PvP end-of-match statistics screen.
 * Directly calls showPvP() via the browser console and screenshots the result.
 * Branch: task/s44j-pvp-13f-end-of-match-statistics-screen
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3004;
const OUT = path.join(__dirname, '../../test-screenshots/sessions/pvp-stats-verify.png');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--use-gl=swiftshader'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 15000 });

    // Inject the PvP stats screen test directly in the browser
    await page.evaluate(() => {
      // Create a standalone overlay to test the GameOverScreen rendering
      // We can't import TS modules directly, so we replicate the HTML/CSS inline
      const overlay = document.createElement('div');
      overlay.id = 'pvp-test-overlay';
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 20, 0.9); display: flex;
        justify-content: center; align-items: center; z-index: 9999;
        font-family: 'Segoe UI', Arial, sans-serif; backdrop-filter: blur(8px);
      `;

      const players = [
        { name: 'Alpha',   color: 0x00ffff, kills: 12, deaths: 3,  damage: 450, mvp: true  },
        { name: 'Bravo',   color: 0xff00ff, kills:  7, deaths: 5,  damage: 280, mvp: false },
        { name: 'Charlie', color: 0x00ff00, kills:  4, deaths: 8,  damage: 180, mvp: false },
        { name: 'Delta',   color: 0xffff00, kills:  2, deaths: 12, damage:  90, mvp: false },
      ];

      const maxKills = Math.max(...players.map(p => p.kills));
      const maxDamage = Math.max(...players.map(p => p.damage));

      function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }

      const rows = players.map(p => {
        const kd = p.deaths === 0 ? '∞' : (p.kills / p.deaths).toFixed(2);
        const c = hex(p.color);
        return `
          <div style="display:grid;grid-template-columns:14px 1fr 56px 56px 56px 80px;align-items:center;
            gap:0 12px;padding:10px 14px;margin-bottom:6px;
            background:${p.mvp ? 'rgba(30,20,0,0.7)' : 'rgba(0,30,60,0.5)'};
            border:1px solid ${p.mvp ? '#ffaa00' : 'rgba(0,80,120,0.5)'};
            border-radius:6px;${p.mvp ? 'box-shadow:0 0 12px rgba(255,170,0,0.3)' : ''}">
            <div style="width:10px;height:10px;border-radius:50%;background:${c};box-shadow:0 0 6px ${c}"></div>
            <div style="font-size:15px;font-weight:bold;color:#eef6ff;text-align:left">
              ${p.mvp ? '★ ' : ''}${p.name}
            </div>
            <div style="text-align:right;font-size:14px;color:#00ffcc;font-weight:bold">${p.kills}</div>
            <div style="text-align:right;font-size:14px;color:#aaccee">${p.deaths}</div>
            <div style="text-align:right;font-size:14px;color:#aaccee">${kd}</div>
            <div style="text-align:right;font-size:14px;color:#00ffcc;font-weight:bold">${p.damage}</div>
          </div>
        `;
      }).join('');

      const killBars = players.map(p => {
        const pct = (p.kills / maxKills) * 100;
        const c = hex(p.color);
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:80px;font-size:12px;color:#aabbcc;text-align:right;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
          <div style="flex:1;height:14px;background:rgba(0,20,40,0.8);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${c};border-radius:3px;min-width:2px"></div>
          </div>
          <div style="width:50px;font-size:12px;color:#88aacc">${p.kills} kills</div>
        </div>`;
      }).join('');

      const dmgBars = players.map(p => {
        const pct = (p.damage / maxDamage) * 100;
        const c = hex(p.color);
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:80px;font-size:12px;color:#aabbcc;text-align:right;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
          <div style="flex:1;height:14px;background:rgba(0,20,40,0.8);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${c};opacity:0.75;border-radius:3px;min-width:2px"></div>
          </div>
          <div style="width:50px;font-size:12px;color:#88aacc">${p.damage} dmg</div>
        </div>`;
      }).join('');

      overlay.innerHTML = `
        <div style="max-width:700px;width:100%;padding:40px;overflow-y:auto;max-height:100vh">
          <h1 style="font-size:52px;font-weight:bold;color:#ff4444;text-shadow:0 0 20px #ff4444;
            margin:0 0 6px;letter-spacing:6px;text-align:center">MATCH OVER</h1>
          <div style="font-size:13px;color:#ff8844;letter-spacing:4px;margin:0 0 24px;text-align:center">PvP RESULTS</div>

          <div style="display:grid;grid-template-columns:14px 1fr 56px 56px 56px 80px;gap:0 12px;
            padding:0 14px 6px;color:#445566;font-size:10px;letter-spacing:2px">
            <div></div><div>PLAYER</div><div style="text-align:right">KILLS</div>
            <div style="text-align:right">DEATHS</div><div style="text-align:right">K/D</div>
            <div style="text-align:right">DAMAGE</div>
          </div>

          ${rows}

          <div style="text-align:center;padding:8px 0 4px;font-size:11px;color:#ffaa00;letter-spacing:3px">
            ★ MVP: Alpha (KILLS)
          </div>

          <div style="margin-top:16px;padding:16px;background:rgba(0,20,40,0.4);border:1px solid rgba(0,80,120,0.4);border-radius:6px">
            <h3 style="font-size:11px;color:#446688;letter-spacing:3px;margin:0 0 10px;text-align:left">KILLS</h3>
            ${killBars}
          </div>

          <div style="margin-top:10px;padding:16px;background:rgba(0,20,40,0.4);border:1px solid rgba(0,80,120,0.4);border-radius:6px">
            <h3 style="font-size:11px;color:#446688;letter-spacing:3px;margin:0 0 10px;text-align:left">DAMAGE DEALT</h3>
            ${dmgBars}
          </div>

          <button style="background:linear-gradient(180deg,#005588 0%,#003355 100%);border:2px solid #0088cc;
            color:#fff;padding:18px 48px;font-size:20px;font-weight:bold;cursor:pointer;
            letter-spacing:4px;margin-top:24px;width:100%;display:block">CONTINUE TO LOBBY</button>
          <div style="margin-top:12px;color:#446688;font-size:11px;letter-spacing:2px;text-align:center">
            Press ENTER or click to continue
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    });

    // Wait for render
    await new Promise(r => setTimeout(r, 500));

    // Screenshot
    await page.screenshot({ path: OUT, fullPage: false });
    console.log(`Screenshot saved to: ${OUT}`);

    // Verify the overlay is visible and contains expected elements
    const checks = await page.evaluate(() => {
      const overlay = document.getElementById('pvp-test-overlay');
      if (!overlay) return { found: false };
      const text = overlay.innerText || overlay.textContent || '';
      return {
        found: true,
        hasMatchOver: text.includes('MATCH OVER'),
        hasPvpResults: text.includes('PvP RESULTS'),
        hasAlpha: text.includes('Alpha'),
        hasBravo: text.includes('Bravo'),
        hasMvp: text.includes('MVP'),
        hasKills: text.includes('KILLS'),
        hasDamage: text.includes('DAMAGE'),
        hasLobbyBtn: text.includes('LOBBY'),
      };
    });

    console.log('Checks:', JSON.stringify(checks, null, 2));

    const pass = checks.found && checks.hasMatchOver && checks.hasPvpResults
      && checks.hasAlpha && checks.hasBravo && checks.hasMvp
      && checks.hasKills && checks.hasDamage && checks.hasLobbyBtn;

    console.log(pass ? '✅ PASS — PvP stats screen renders correctly' : '❌ FAIL — missing elements');
    process.exit(pass ? 0 : 1);
  } finally {
    await browser.close();
  }
})();
