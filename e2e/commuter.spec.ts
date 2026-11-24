import { API } from './playwright.config';
import { CC_MARKET, expect, KG_METRO, REPORT_TOKENS, test, TIS_HAZARI, WEB } from './fixtures';

const planUrl = (from: string, to: string) =>
  `${WEB}/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

test.describe('commuter web app', () => {
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

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/You.re offline/)).toBeVisible();
    await expect(page.getByRole('article').first()).toContainText('KG-1');
    await context.setOffline(false);
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
