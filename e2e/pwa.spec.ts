import {
  CC_MARKET,
  expect,
  photonRequests,
  planUrl,
  test,
  TIS_HAZARI,
  WEB,
} from './fixtures';

/** GAME_PLAN Contributor 1 tasks that the main commuter spec doesn't already cover. */
test.describe('commuter app (C1)', () => {
  test('1.1 phones get a draggable bottom sheet, desktops a side panel', async ({
    isolated: page,
  }, testInfo) => {
    await page.goto(WEB);
    const panel = page.getByRole(testInfo.project.name === 'desktop' ? 'complementary' : 'region', {
      name: 'Trip planner',
    });
    await expect(panel).toBeVisible();
    if (testInfo.project.name === 'desktop') {
      const box = (await panel.boundingBox())!;
      expect(box.width).toBeGreaterThan(380);
      expect(box.x).toBeLessThan(40);
      return;
    }
    const before = (await panel.boundingBox())!.height;
    await page.getByRole('button', { name: 'Expand panel' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(before + 100);
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(
      page.viewportSize()!.height * 0.85,
    );
  });

  test('1.2 "current location" uses GPS as the start', async ({ isolated: page, context }) => {
    await context.grantPermissions(['geolocation'], { origin: WEB });
    await context.setGeolocation({ latitude: 28.6675, longitude: 77.2282 });
    await page.goto(`${WEB}/?to=${encodeURIComponent(CC_MARKET)}`);
    await page.getByRole('button', { name: 'Start from my current location' }).click();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue('Current location');
    await expect(page.getByRole('article').first()).toContainText('KG-1');
  });

  test('1.2 a denied location permission explains what to do', async ({ isolated: page, context }) => {
    await context.clearPermissions();
    await page.goto(WEB);
    await page.getByRole('button', { name: 'Start from my current location' }).click();
    await expect(page.getByRole('alert')).toContainText(/Location is blocked|Couldn.t find your location/);
  });

  test('1.2 place search is debounced (one request per pause, not per keystroke)', async ({
    isolated: page,
  }) => {
    await page.goto(WEB);
    const to = page.getByRole('combobox', { name: 'To' });
    await to.pressSequentially('Red Fort', { delay: 40 });
    await expect(page.getByRole('option', { name: /Red Fort/ })).toBeVisible();
    // 8 keystrokes, 6 of them ≥ 3 characters: without debouncing that is 6 requests.
    expect(photonRequests).toBeGreaterThan(0);
    expect(photonRequests).toBeLessThanOrEqual(2);
  });

  test('1.4 nothing nearby → the closest line is snapped and named', async ({ isolated: page }) => {
    await page.goto(planUrl(TIS_HAZARI));
    await page.getByRole('tab', { name: 'Nearby lines' }).click();
    await page.getByRole('radio', { name: '500 m' }).click();
    await expect(page.getByText('No lines stop within 500 m.')).toBeVisible();
    const closest = page.getByRole('region', { name: 'Closest line' });
    await expect(closest).toContainText('CL-6');
    await expect(closest).toContainText('Mori Gate');
  });

  test('1.5 install prompt appears after a successful search and triggers the browser prompt', async ({
    isolated: page,
  }) => {
    await page.goto(planUrl('28.66750,77.22820,Kashmere Gate Metro'));
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      e.prompt = async () => {
        (window as unknown as { __prompted: boolean }).__prompted = true;
      };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    // Not yet: the app hasn't proved useful.
    await expect(page.getByRole('region', { name: 'Install the app' })).toBeHidden();
    await page.getByRole('combobox', { name: 'To' }).fill('Chandni');
    await page.getByRole('option', { name: /Chandni Chowk Market/ }).click();
    await expect(page.getByRole('article').first()).toBeVisible();

    const banner = page.getByRole('region', { name: 'Install the app' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Install', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
    await expect(banner).toBeHidden();
  });

  test('1.5 web app manifest is installable (name, standalone, 192/512 + maskable icons)', async ({
    request,
  }) => {
    const manifest = await (await request.get(`${WEB}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ short_name: 'Transit', display: 'standalone', start_url: '/' });
    const sizes = (manifest.icons as { sizes: string; purpose?: string; src: string }[]).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) {
      const res = await request.get(`${WEB}/${icon.src}`);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    }
  });

  test('loads the planner in under 1.5 s on a throttled 3G phone', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile budget');
    // Fresh context: no service worker or HTTP cache (first visit from a QR code).
    const context = await browser.newContext({ ...testInfo.project.use });
    const page = await context.newPage();
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort());
    const cdp = await context.newCDPSession(page);
    // Lighthouse "slow 4G / regular 3G" mobile profile: 150 ms RTT, 1.6 Mbps down, 4× CPU slowdown.
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    const t0 = Date.now();
    await page.goto(WEB, { waitUntil: 'commit' });
    await expect(page.getByRole('combobox', { name: 'To' })).toBeVisible({ timeout: 10_000 });
    const ms = Date.now() - t0;
    testInfo.annotations.push({ type: 'load time (3G, 4× CPU)', description: `${ms} ms` });
    console.log(`planner usable after ${ms} ms on throttled 3G`);
    expect(ms).toBeLessThan(1500);
    await context.close();
  });
});
