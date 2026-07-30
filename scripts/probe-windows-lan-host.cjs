const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(root, 'test-screenshots', `windows-lan-host-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_EXE,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) {
  throw new Error('No Windows Chrome/Edge executable found');
}

const report = {
  startedAt: new Date().toISOString(),
  chromePath,
  outDir,
  steps: [],
  console: [],
  pageErrors: [],
  requestsFailed: [],
  finalUrl: '',
  serverHealth: null,
  lanStatus: null,
};

function note(step, data = {}) {
  const entry = { at: new Date().toISOString(), step, ...data };
  report.steps.push(entry);
  console.log(`[probe] ${step}`, Object.keys(data).length ? JSON.stringify(data) : '');
}

async function saveShot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  note('screenshot', { name, file });
  return file;
}

async function waitForText(page, selector, text, timeout = 20000) {
  await page.waitForFunction(
    (sel, expected) => {
      const el = document.querySelector(sel);
      return !!el && (el.textContent || '').includes(expected);
    },
    { timeout },
    selector,
    text
  );
}

async function clickTextButton(page, text, timeout = 20000) {
  await page.waitForFunction(
    (expected) => {
      return [...document.querySelectorAll('button')]
        .some((btn) => (btn.textContent || '').trim() === expected);
    },
    { timeout },
    text
  );
  await page.evaluate((expected) => {
    const btn = [...document.querySelectorAll('button')]
      .find((candidate) => (candidate.textContent || '').trim() === expected);
    btn.click();
  }, text);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.text();
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(body) };
  } catch {
    return { ok: res.ok, status: res.status, body };
  }
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      defaultViewport: { width: 1280, height: 900 },
      args: [
        '--no-first-run',
        '--disable-background-networking',
        '--disable-features=Translate,MediaRouter',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    const page = await browser.newPage();
    page.on('console', (msg) => {
      report.console.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      report.pageErrors.push(String(err.stack || err.message || err));
    });
    page.on('requestfailed', (req) => {
      report.requestsFailed.push({ url: req.url(), error: req.failure()?.errorText || '' });
    });

    note('goto-menu');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForSelector('button[data-mode="lan"]', { timeout: 30000 });
    await saveShot(page, '01-menu');

    note('open-lan-panel');
    await page.click('button[data-mode="lan"]');
    await page.waitForSelector('#lan-host-btn', { visible: true, timeout: 15000 });

    note('open-host-options');
    await page.click('#lan-host-btn');
    await page.waitForSelector('#lan-start-host-btn', { visible: true, timeout: 15000 });

    const pvpveSelected = await page.evaluate(() => {
      const btn = document.querySelector('.lan-mode-btn[data-lan-mode="pvpve"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    note('select-pvpve', { pvpveSelected });

    note('start-hosting');
    await page.click('#lan-start-host-btn');
    await waitForText(page, '#lan-host-status', 'Server running!', 30000);
    await page.waitForSelector('#lan-enter-btn:not(.hidden)', { timeout: 15000 });
    await saveShot(page, '02-host-ready');

    report.lanStatus = await fetchJson('http://localhost:3000/__lan/status');
    report.serverHealth = await fetchJson('http://localhost:2567/health');
    note('host-status', { lanStatus: report.lanStatus, serverHealth: report.serverHealth });

    note('enter-game');
    await page.click('#lan-enter-btn');
    await page.waitForSelector('#lan-name-input', { visible: true, timeout: 15000 });
    await page.click('#lan-name-input');
    await page.keyboard.type('CodexWinHost');
    await page.click('#lan-name-join-btn');

    await page.waitForFunction(() => location.href.includes('mode=network'), { timeout: 30000 });
    await saveShot(page, '03-lobby');

    note('wait-start-button');
    await clickTextButton(page, 'START GAME', 45000);
    await new Promise((resolve) => setTimeout(resolve, 7000));
    await saveShot(page, '04-after-start');

    report.finalUrl = page.url();
    report.finalBodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    report.lanStatusAfterStart = await fetchJson('http://localhost:3000/__lan/status');
    report.serverHealthAfterStart = await fetchJson('http://localhost:2567/health');
    note('done', { finalUrl: report.finalUrl });
  } catch (err) {
    report.error = String(err && (err.stack || err.message) || err);
    note('error', { error: report.error });
    throw err;
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    const reportPath = path.join(root, 'reports', `windows-lan-host-probe-${stamp}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[probe] report ${reportPath}`);
  }
})().catch(() => process.exit(1));
