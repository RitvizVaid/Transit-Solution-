import { API } from './playwright.config';
import { expect, KG_METRO, planUrl, RED_FORT, sourceFeatures, test, waitForMap } from './fixtures';

test.describe('map (C2)', () => {
  // The app's service worker fetches map tiles itself (cache-first), and requests made by a
  // service worker bypass page.route. Map tests run without it so the style/tile stubs apply;
  // offline behaviour (which needs the worker) is covered in commuter.spec.ts.
  test.use({ serviceWorkers: 'block' });

  test('2.1/2.2 draws the selected itinerary: rides in route colour, walks dashed', async ({
    isolated: page,
    request,
  }) => {
    await page.goto(planUrl(KG_METRO, RED_FORT, '&debug=map'));
    await expect(page.getByRole('article').first()).toContainText('M-14');
    await waitForMap(page);

    const plan = await (
      await request.get(
        `${API}/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6563&toLng=77.2412`,
      )
    ).json();
    const legs = plan.itineraries[0].legs as { mode: string; routeColor?: string }[];

    await expect.poll(async () => (await sourceFeatures(page, 'route')).length).toBe(legs.length);
    const features = await sourceFeatures(page, 'route');
    features.forEach((f, i) => {
      expect(f.properties.walk).toBe(legs[i]!.mode === 'WALK');
      if (legs[i]!.mode !== 'WALK') expect(f.properties.color).toBe(legs[i]!.routeColor);
      expect((f.geometry.coordinates as unknown[]).length).toBeGreaterThanOrEqual(2);
    });
  });

  test('2.3 stands are drawn by queue level and open a status popup when tapped', async ({
    isolated: page,
  }) => {
    await page.goto(planUrl(KG_METRO, undefined, '&debug=map'));
    await waitForMap(page);
    await expect
      .poll(async () => (await sourceFeatures(page, 'stands')).length)
      .toBeGreaterThanOrEqual(10);
    // Queue colours only for stands with a report in effect; grey = schedule estimate only.
    const stands = (await sourceFeatures(page, 'stands')).map((f) => ({
      color: String(f.properties.color),
      source: (JSON.parse(String(f.properties.json)) as { source: string }).source,
    }));
    for (const s of stands) {
      if (s.source === 'reported') expect(['#10b981', '#f59e0b', '#e11d48']).toContain(s.color);
      else expect(s.color).toBe('#94a3b8');
    }

    // Centre the Kashmere Gate stand and tap it.
    const point = await page.evaluate(async () => {
      const m = (
        window as unknown as {
          __transitMap: {
            jumpTo(o: object): void;
            once(e: string, cb: () => void): void;
            project(ll: [number, number]): { x: number; y: number };
            getCanvas(): HTMLCanvasElement;
          };
        }
      ).__transitMap;
      m.jumpTo({ center: [77.2296, 28.6662], zoom: 17 });
      await new Promise<void>((r) => m.once('idle', r));
      const p = m.project([77.2296, 28.6662]);
      const box = m.getCanvas().getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    });
    await page.mouse.click(point.x, point.y);
    const popup = page.locator('.maplibregl-popup');
    await expect(popup).toContainText('Kashmere Gate Auto Stand');
    // Either a report in effect, or the schedule estimate clearly labelled as such.
    await expect(popup).toContainText(/min wait|Typical wait ~\d+ min \(from the schedule\)/);
  });

  test('2.4 live vehicles appear and move along their routes', async ({ isolated: page }) => {
    await page.goto(planUrl(KG_METRO, undefined, '&debug=map'));
    await waitForMap(page);
    await expect
      .poll(async () => (await sourceFeatures(page, 'vehicles')).length, { timeout: 10_000 })
      .toBeGreaterThan(3);
    const before = JSON.stringify(
      (await sourceFeatures(page, 'vehicles')).map((f) => f.geometry.coordinates),
    );
    await page.waitForTimeout(3000);
    const after = JSON.stringify(
      (await sourceFeatures(page, 'vehicles')).map((f) => f.geometry.coordinates),
    );
    expect(after).not.toBe(before);
  });

  test('shows Delhi bus positions separately and preserves rider vehicles on feed failure', async ({
    isolated: page,
  }, testInfo) => {
    let failFeed = () => {
      throw new Error('WebSocket not connected');
    };
    await page.routeWebSocket('**/api/v1/live', (socket) => {
      failFeed = () =>
        socket.send(
          JSON.stringify({
            type: 'vehicle.source.status',
            payload: { source: 'delhi-otd', status: 'error' },
          }),
        );
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw)) as { type: string };
        if (message.type !== 'subscribe.bbox') return;
        socket.send(
          JSON.stringify({
            type: 'vehicle.source.status',
            payload: { source: 'delhi-otd', status: 'ok' },
          }),
        );
        for (const [vehicleId, source] of [
          ['bus', 'delhi-otd'],
          ['rider', 'crowd'],
        ]) {
          socket.send(
            JSON.stringify({
              type: 'vehicle.position',
              payload: {
                vehicleId,
                source,
                mode: 'BUS',
                coordinates: source === 'delhi-otd' ? [77.237, 28.661] : [77.2296, 28.6662],
                timestamp: new Date().toISOString(),
              },
            }),
          );
        }
      });
    });
    await page.goto(planUrl(KG_METRO, undefined, '&debug=map'));
    await waitForMap(page);
    await expect(page.getByText('Delhi bus position', { exact: true })).toBeVisible();
    await expect(page.getByText('Tap a blue and amber dot for details.')).toBeVisible();
    await expect.poll(async () => (await sourceFeatures(page, 'vehicles')).length).toBe(2);
    const point = await page.evaluate(async () => {
      const m = (
        window as unknown as {
          __transitMap: {
            jumpTo(o: object): void;
            once(e: string, cb: () => void): void;
            project(ll: [number, number]): { x: number; y: number };
            getCanvas(): HTMLCanvasElement;
          };
        }
      ).__transitMap;
      m.jumpTo({
        center: [77.237, 28.661],
        zoom: 16,
        padding: {
          top: 0,
          right: 0,
          bottom: window.innerWidth < 768 ? window.innerHeight * 0.45 : 0,
          left: 0,
        },
      });
      await new Promise<void>((r) => m.once('idle', r));
      const p = m.project([77.237, 28.661]);
      const box = m.getCanvas().getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    });
    if (testInfo.project.name === 'mobile') await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    const popup = page.locator('.maplibregl-popup');
    await expect(popup).toContainText('Delhi bus');
    await expect(popup).toContainText('Position reported');
    await expect(popup).toContainText('Route number and destination are not available.');
    await expect(popup).toContainText('Source: Delhi Open Transit Data');
    failFeed();
    await expect(page.getByText('Delhi bus positions unavailable', { exact: false })).toBeVisible();
    await expect(popup).toHaveCount(0);
    await expect.poll(async () => (await sourceFeatures(page, 'vehicles')).length).toBe(1);
    expect((await sourceFeatures(page, 'vehicles'))[0]?.properties.crowd).toBe(true);
  });

  test('long-press (touch) / right-click (mouse) on the map sets the destination', async ({
    isolated: page,
    context,
  }, testInfo) => {
    await page.goto(planUrl(KG_METRO, undefined, '&debug=map'));
    await waitForMap(page);
    // An empty spot south-east of Red Fort: centred so it's visible (not under the sheet /
    // side panel) and away from stand markers, where a tap would open the stand popup.
    const point = await page.evaluate(async () => {
      const m = (
        window as unknown as {
          __transitMap: {
            jumpTo(o: object): void;
            once(e: string, cb: () => void): void;
            project(ll: [number, number]): { x: number; y: number };
            getCanvas(): HTMLCanvasElement;
          };
        }
      ).__transitMap;
      m.jumpTo({ center: [77.2445, 28.6535], zoom: 15 });
      await new Promise<void>((r) => m.once('idle', r));
      const p = m.project([77.2445, 28.6535]);
      const box = m.getCanvas().getBoundingClientRect();
      return { x: Math.round(box.left + p.x), y: Math.round(box.top + p.y) };
    });

    if (testInfo.project.name === 'mobile') {
      // A real touch long-press: touchstart, hold > 550 ms, touchend.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await page.waitForTimeout(800);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.click(point.x, point.y, { button: 'right' });
    }
    await page.getByRole('button', { name: 'Go here' }).click();
    await expect(page).toHaveURL(/[?&]to=/);
    // Name comes from (stubbed) reverse geocoding.
    await expect(page.getByRole('combobox', { name: 'To' })).toHaveValue('Red Fort');
    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('Nearby tab draws its search radius', async ({ isolated: page }) => {
    await page.goto(planUrl(KG_METRO, undefined, '&debug=map'));
    await waitForMap(page);
    await page.getByRole('tab', { name: 'Nearby lines' }).click();
    await expect
      .poll(async () => (await sourceFeatures(page, 'nearby'))[0]?.geometry.type)
      .toBe('Polygon');
  });
});
