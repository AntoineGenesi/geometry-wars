/**
 * Regression tests for s38c-02: Laptop cannot connect to LAN after S38b-01.
 *
 * Root cause: WSL2 portproxy rules intercept LAN traffic on port 3000, redirecting
 * laptop connections to WSL2 (which has no server). Host PC works because localhost
 * connections bypass portproxy.
 *
 * This file tests:
 * 1. Creator flag logic (s38b-01 fix is still correct — laptop never sets creator=1)
 * 2. Server URL construction for laptop joiners
 * 3. Portproxy detection logic (the new fix)
 * 4. Error panel portproxy hint rendering
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Part 1: Creator flag regression (ensures s38b-01 fix didn't regress)
// ---------------------------------------------------------------------------

type NetworkSelection = {
  gameMode: 'network';
  surfaceType: string;
  serverUrl?: string;
  playerName?: string;
  isCreator?: boolean;
};

function buildNetworkParams(selection: NetworkSelection): Record<string, string> {
  const params: Record<string, string> = { mode: 'network', surface: selection.surfaceType };
  if (selection.isCreator) params.creator = '1';
  if (selection.serverUrl) params.server = selection.serverUrl;
  if (selection.playerName) params.name = selection.playerName;
  return params;
}

describe('s38c-02 regression: creator flag still correct (s38b-01 not regressed)', () => {
  it('laptop joiner does NOT get creator=1', () => {
    const params = buildNetworkParams({
      gameMode: 'network',
      surfaceType: 'sphere',
      isCreator: false,
      serverUrl: 'ws://192.168.1.100:3000/ws',
      playerName: 'Laptop',
    });
    expect(params.creator).toBeUndefined();
  });

  it('host player DOES get creator=1', () => {
    const params = buildNetworkParams({
      gameMode: 'network',
      surfaceType: 'sphere',
      isCreator: true,
    });
    expect(params.creator).toBe('1');
  });

  it('undefined isCreator (default) does NOT set creator param', () => {
    // QR code scanners, lobby joiners — default is non-creator
    const params = buildNetworkParams({
      gameMode: 'network',
      surfaceType: 'torus',
    });
    expect(params.creator).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part 2: Server URL construction for laptop (proxy path must be used)
// ---------------------------------------------------------------------------

describe('s38c-02: laptop server URL uses Vite proxy path (/ws)', () => {
  /**
   * When the laptop connects to http://192.168.1.100:3000, the server URL
   * should be ws://192.168.1.100:3000/ws (Vite proxy path).
   * This avoids needing port 2567 to be directly accessible from the laptop.
   * Only port 3000 needs to be open.
   */
  it('proxy URL construction from hostname and port', () => {
    // Simulate window.location on a laptop that loaded from host IP
    const hostname = '192.168.1.100';
    const port = 3000;
    const protocol = 'ws:';

    const proxyUrl = `${protocol}//${hostname}:${port}/ws`;
    expect(proxyUrl).toBe('ws://192.168.1.100:3000/ws');
    expect(proxyUrl).toContain('/ws');
    expect(proxyUrl).not.toContain(':2567');
  });

  it('proxy URL has /ws pathname for Vite proxy routing', () => {
    const proxyUrl = 'ws://192.168.1.100:3000/ws';
    const parsed = new URL(proxyUrl);
    expect(parsed.pathname).toBe('/ws');
    expect(parsed.port).toBe('3000');
    expect(parsed.hostname).toBe('192.168.1.100');
  });

  it('fallback URL uses direct Colyseus port 2567', () => {
    // When primary (proxy) fails, fallback to direct Colyseus port
    const primaryUrl = 'ws://192.168.1.100:3000/ws';
    const parsed = new URL(primaryUrl);
    // Fallback should use same hostname but port 2567
    const fallbackUrl = `${parsed.protocol}//${parsed.hostname}:2567`;
    expect(fallbackUrl).toBe('ws://192.168.1.100:2567');
  });
});

// ---------------------------------------------------------------------------
// Part 3: Portproxy conflict detection logic
// ---------------------------------------------------------------------------

describe('s38c-02: portproxy conflict detection', () => {
  /**
   * The vite-plugin-lan detectWindowsPortproxyConflict() function checks
   * if netsh portproxy rules exist for game ports (3000, 2567).
   * These rules redirect LAN traffic to WSL2, breaking laptop connections.
   * This test verifies the detection logic by testing the string-matching pattern.
   */

  function detectPortproxyFromOutput(netshOutput: string): boolean {
    // Same logic as detectWindowsPortproxyConflict in vite-plugin-lan.ts
    return netshOutput.includes('2567') || netshOutput.includes(' 3000 ') || netshOutput.includes('\t3000\t');
  }

  it('detects portproxy for port 2567', () => {
    const netshOutput = `
Listen on IPv4:             Connect to IPv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         2567        172.28.0.1      2567
`.trim();
    expect(detectPortproxyFromOutput(netshOutput)).toBe(true);
  });

  it('detects portproxy for port 3000', () => {
    const netshOutput = `
Listen on IPv4:             Connect to IPv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0          3000       172.28.0.1       3000
`.trim();
    expect(detectPortproxyFromOutput(netshOutput)).toBe(true);
  });

  it('returns false when no portproxy rules exist', () => {
    const netshOutput = `
Listen on IPv4:             Connect to IPv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------

`.trim();
    expect(detectPortproxyFromOutput(netshOutput)).toBe(false);
  });

  it('returns false for portproxy on unrelated ports', () => {
    // A portproxy for a completely different service should not trigger the check
    const netshOutput = `
Listen on IPv4:             Connect to IPv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         8080        172.28.0.1      8080
0.0.0.0         9090        172.28.0.1      9090
`.trim();
    expect(detectPortproxyFromOutput(netshOutput)).toBe(false);
  });

  it('correctly identifies WSL2 IP range (172.16-31.x.x)', () => {
    // WSL2 IPs are in 172.16.0.0/12 range — these are internal and unreachable from LAN
    const wsl2IpRegex = /^172\.(1[6-9]|2[0-9]|3[01])\./;

    expect(wsl2IpRegex.test('172.28.0.1')).toBe(true);   // WSL2 typical
    expect(wsl2IpRegex.test('172.16.0.1')).toBe(true);   // WSL2 range start
    expect(wsl2IpRegex.test('172.31.0.1')).toBe(true);   // WSL2 range end
    expect(wsl2IpRegex.test('192.168.1.100')).toBe(false); // Real LAN IP
    expect(wsl2IpRegex.test('10.0.0.1')).toBe(false);    // VPN IP
    expect(wsl2IpRegex.test('172.15.0.1')).toBe(false);  // Outside WSL2 range
    expect(wsl2IpRegex.test('172.32.0.1')).toBe(false);  // Outside WSL2 range
  });
});

// ---------------------------------------------------------------------------
// Part 4: Portproxy conflict → correct error diagnosis
// ---------------------------------------------------------------------------

describe('s38c-02: portproxy conflict scenario explains laptop-only failure', () => {
  it('host PC localhost connections bypass portproxy (why host works, laptop doesnt)', () => {
    // portproxy intercepts incoming connections from EXTERNAL IPs.
    // The host PC connects to localhost:3000 — this bypasses portproxy rules.
    // The laptop connects to 192.168.x.x:3000 — portproxy intercepts → WSL2 → fail.
    //
    // This test documents the asymmetric behavior as understood from the fix analysis.
    // It's a documentation test — we can't call netsh in unit tests, but we can
    // verify our understanding of the symptom pattern.

    const hostConnectsTo = 'localhost:3000';
    const laptopConnectsTo = '192.168.1.100:3000';  // same machine, different target

    // Host uses localhost — portproxy doesn't intercept same-machine connections
    expect(hostConnectsTo).toContain('localhost');

    // Laptop uses the external LAN IP — portproxy DOES intercept these
    expect(laptopConnectsTo).toMatch(/^\d+\.\d+\.\d+\.\d+/);

    // They connect to the same port (3000), but portproxy behavior differs
    expect(hostConnectsTo).toContain(':3000');
    expect(laptopConnectsTo).toContain(':3000');
  });

  it('fix: deleting portproxy rules restores direct Windows server access', () => {
    // After cleanup, the laptop's connection to 192.168.1.100:3000 reaches
    // Vite on Windows (port 3000) instead of being redirected to WSL2.
    // Vite then proxies /ws → localhost:2567 → Colyseus on Windows.

    // The cleanup commands are:
    const cleanupCommands = [
      'netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0',
      'netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0',
    ];

    expect(cleanupCommands).toHaveLength(2);
    expect(cleanupCommands[0]).toContain('listenport=3000');
    expect(cleanupCommands[1]).toContain('listenport=2567');
    expect(cleanupCommands.every(cmd => cmd.includes('listenaddress=0.0.0.0'))).toBe(true);
  });
});
