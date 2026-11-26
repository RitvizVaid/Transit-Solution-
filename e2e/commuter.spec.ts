import type { PlanResponse } from '@transit/shared-types';
import { API } from './playwright.config';
import { CC_MARKET, expect, KG_METRO, REPORT_TOKENS, test, TIS_HAZARI, WEB } from './fixtures';

const planUrl = (from: string, to: string) =>
  `${WEB}/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

test.describe('commuter web app', () => {
  test.describe('trip comparison', () => {
    test.use({ serviceWorkers: 'block' });

    test('reorders options without changing the selected route', async ({ isolated: page }) => {
      await page.route('**/api/v1/plan?*', async (route) => {
        const response = await route.fetch();
        const { itineraries } = (await response.json()) as PlanResponse;
        const base = itineraries[0]!;
        await route.fulfill({
          json: {
            itineraries: [
              ['Option A', 900, 20, 80],
              ['Option B', 700, 30, 100],
              ['Option C', 800, 10, 120],
              ['Option D', 1000, 0, 150],
            ].map(([name, durationSeconds, amount, walkTimeSeconds]) => ({
              ...base,
              id: name,
              durationSeconds,
              estimatedFare: { currency: 'INR', amount },
              fareUnavailable: name === 'Option D' ? true : undefined,
              walkTimeSeconds,
              legs: base.legs.map((leg) => ({ ...leg, routeShortName: name })),
            })),
          },
        });
      });
      await page.goto(planUrl(KG_METRO, CC_MARKET));
      const compare = page.getByRole('combobox', { name: 'Compare by' });
      const cards = page.getByRole('article');
      await expect(cards.first()).toContainText('Option A');
      await expect(cards.filter({ hasText: 'Option D' })).toContainText('Fare unavailable');
      for (const [criterion, first] of [
        ['duration', 'Option B'],
        ['fare', 'Option C'],
        ['walking', 'Option A'],
        ['recommended', 'Option A'],
      ]) {
        await compare.selectOption(criterion);
        await expect(cards.first()).toContainText(first);
        await expect(
          cards.filter({ hasText: 'Option A' }).locator('button[aria-expanded]'),
        ).toHaveAttribute('aria-expanded', 'true');
      }
      await compare.selectOption('fare');
      await expect(cards.last()).toContainText('Option D');
    });
  });

  test.describe('trip refresh', () => {
    test.use({ serviceWorkers: 'block' });

    test('labels a previously viewed trip as updating when returning to it', async ({
      isolated: page,
    }) => {
      const pending = Promise.withResolvers<void>();
      let requests = 0;
      await page.route('**/api/v1/plan?*', async (route) => {
        if (++requests > 1) await pending.promise;
        await route.fallback().catch(() => undefined);
      });
      try {
        await page.goto(planUrl(KG_METRO, CC_MARKET));
        await expect(page.getByRole('article').first()).toContainText('KG-1');
        const to = page.getByRole('combobox', { name: 'To' });
        await to.fill('Red Fort');
        await page.getByRole('option', { name: /Red Fort/ }).click();
        await expect.poll(() => requests).toBe(2);
        await to.fill('Chandni');
        await page.getByRole('option', { name: /Chandni Chowk Market/ }).click();
        await expect.poll(() => requests).toBe(3);
        await expect(page.getByText('Updating…')).toBeVisible();
        await expect(page.getByRole('article').first()).toContainText('KG-1');
      } finally {
        pending.resolve();
      }
      await expect(page.getByText('Updating…')).toBeHidden();
    });
  });

  test('a shared trip link shows itineraries with fares and step-by-step directions', async ({
    isolated: page,
  }) => {
    await page.goto(planUrl(KG_METRO, CC_MARKET));
    const first = page.getByRole('article').first();
    await expect(first).toContainText('KG-1');
    await expect(first).toContainText('₹20');
    // The best option is expanded with its timeline.
    await expect(first).toContainText('Shared auto KG-1');
    await expect(first).toContainText('Arrive at Chandni Chowk Market');
    await expect(page.getByRole('heading', { name: /ways? to go/ })).toBeVisible();
  });

  test('search a destination, pick it, and plan', async ({ isolated: page }) => {
    await page.goto(`${WEB}/?from=${encodeURIComponent(KG_METRO)}`);
    const to = page.getByRole('combobox', { name: 'To' });
    await to.fill('Red Fort');
    const option = page.getByRole('option', { name: /Red Fort/ });
    await expect(option).toBeVisible();
    await to.press('ArrowDown');
    await to.press('Enter');
    await expect(to).toHaveValue('Red Fort');
    await expect(page).toHaveURL(/to=28\.65630%2C77\.24120%2CRed\+Fort|to=28\.65630,77\.24120,Red/);
    await expect(page.getByRole('article').first()).toContainText('M-14');
  });

  test('nearby lines respond to the radius', async ({ isolated: page }) => {
    await page.goto(`${WEB}/?from=${encodeURIComponent(KG_METRO)}`);
    await page.getByRole('tab', { name: 'Nearby lines' }).click();
    await expect(page.getByText(/lines? within 300 m/)).toBeVisible();
    await expect(page.getByText('Civil Lines - Kashmere Gate')).toBeVisible();
    await page.getByRole('radio', { name: '100 m' }).click();
    await expect(page.getByText(/within 100 m/)).toBeVisible();
    await page.getByRole('radio', { name: '500 m' }).click();
    await expect(page.getByText('Kashmere Gate - Chandni Chowk')).toBeVisible();
  });

  test('live stand reports reach an open itinerary without reloading', async ({
    isolated: page,
    request,
  }) => {
    await page.goto(planUrl(KG_METRO, CC_MARKET));
    const first = page.getByRole('article').first();
    // Stand info is either the schedule (no report yet) or labelled as a report. The mobile
    // and desktop projects share one API, so an earlier run may already have reported.
    await expect(first).toContainText(/no stand report yet|reported \S/);
    for (let i = 0; i < 2; i++) {
      const res = await request.post(`${API}/api/v1/telemetry/reports`, {
        headers: { authorization: `Bearer ${REPORT_TOKENS['kg-auto-1']}` },
        data: {
          reportId: crypto.randomUUID(),
          standId: 'kg-auto-1',
          kind: 'STAND_FULL',
          reportedAt: new Date().toISOString(),
        },
      });
      expect(res.status()).toBe(202);
    }
    // Pushed over the WebSocket (no polling within the timeout).
    await expect(first).toContainText('very crowded', { timeout: 5000 });
    await expect(first).toContainText('0 autos at stand');
  });

  test('a planned trip still opens offline', async ({ isolated: page, context }) => {
    await page.goto(planUrl(KG_METRO, CC_MARKET));
    await expect(page.getByRole('article').first()).toContainText('KG-1');
    // Wait until the service worker controls the page, so the app shell is cached.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r));
      }
    });

    // Fetch under service-worker control, then remove the localStorage fallback.
    await page.reload();
    await expect(page.getByRole('article').first()).toContainText('KG-1');
    await expect
      .poll(() => page.evaluate(async () => (await (await caches.open('api-plan')).keys()).length))
      .toBeGreaterThan(0);
    await page.evaluate(async () => {
      const cache = await caches.open('api-plan');
      const [request] = await cache.keys();
      const response = await cache.match(request!);
      const headers = new Headers(response!.headers);
      headers.set('date', new Date(Date.now() - 20 * 60_000).toUTCString());
      await cache.put(request!, new Response(response!.body, { headers }));
      localStorage.removeItem('transit.recentTrips.v1');
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/You.re offline/)).toBeVisible();
    await expect(page.getByRole('article').first()).toContainText('KG-1');
    await expect(page.getByText('Saved 20 min ago')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('transit.recentTrips.v1'))).toBeNull();
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole('article').first()).toContainText('KG-1');
    await expect(page.getByText(/^Saved /)).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('transit.recentTrips.v1')))
      .not.toBeNull();
  });

  test('works on a narrow phone and a desktop without horizontal scrolling', async ({
    isolated: page,
  }) => {
    await page.goto(planUrl(KG_METRO, CC_MARKET));
    await expect(page.getByRole('article').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('health and API docs are served', async ({ request }) => {
    expect((await request.get(`${API}/health`)).ok()).toBe(true);
    expect((await request.get(`${API}/docs/json`)).ok()).toBe(true);
  });

  test('an empty result explains why and lets the commuter suggest a route', async ({
    isolated: page,
  }) => {
    // Tis Hazari is ~900 m from the nearest corridor: beyond the walking limit.
    await page.goto(planUrl(TIS_HAZARI, '28.62860,77.24100,ITO'));
    await expect(
      page.getByText(/none of the routes this app knows stop within a short walk of your start/i),
    ).toBeVisible();

    await page.getByRole('button', { name: /Know a shared auto or bus/ }).click();
    const form = page.getByRole('form', { name: 'Suggest a route' });
    await form.getByLabel('Vehicle', { exact: true }).selectOption('E_RICKSHAW');
    await form.getByLabel(/Name or number/).fill('Tis Hazari - ITO');
    await form.getByLabel(/Usual fare/).fill('25');
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/suggestions'));
    await form.getByRole('button', { name: 'Send suggestion' }).click();
    const body = (await sent).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ mode: 'E_RICKSHAW', routeName: 'Tis Hazari - ITO', fareInr: 25 });
    await expect(page.getByText(/saved for review/)).toBeVisible();
  });

  test('switches the planner to Hindi and remembers the choice', async ({ isolated: page }) => {
    await page.goto(planUrl(KG_METRO, CC_MARKET));
    await expect(page.getByRole('article').first()).toContainText('Shared auto KG-1');
    await page.getByRole('button', { name: 'Change language' }).click();

    await expect(page.getByRole('tab', { name: 'यात्रा प्लान करें' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /जाने के? \d+ तरीक/ })).toBeVisible();
    const first = page.getByRole('article').first();
    await expect(first).toContainText('शेयर्ड ऑटो KG-1');
    await expect(first).toContainText('अनुमानित किराया');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('hi');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'यात्रा प्लान करें' })).toBeVisible();
    await page.getByRole('button', { name: 'भाषा बदलें' }).click();
    await expect(page.getByRole('tab', { name: 'Plan a trip' })).toBeVisible();
  });
});
