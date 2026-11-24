import { API } from './playwright.config';
import { expect, KG_METRO, planUrl, RED_FORT, sourceFeatures, test, waitForMap } from './fixtures';

/** GAME_PLAN Contributor 2: map engine, route rendering, stand markers, live vehicles, picking. */
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
    const colours = new Set((await sourceFeatures(page, 'stands')).map((f) => f.properties.color));
    expect([...colours].every((c) => ['#10b981', '#f59e0b', '#e11d48'].includes(String(c)))).toBe(
      true,
    );

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
    await expect(popup).toContainText('min wait');
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
