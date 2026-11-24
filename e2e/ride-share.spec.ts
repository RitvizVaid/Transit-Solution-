import type { ServerMessage } from '@transit/shared-types';
import { CC_MARKET, expect, KG_METRO, planUrl, test } from './fixtures';
import { API } from './playwright.config';

/** On KG-1 between GPO and Chandni Chowk Metro. */
const ON_KG1 = { latitude: 28.66, longitude: 77.2302 };
/** Dwarka: nowhere near the pilot corridors. */
const FAR_AWAY = { latitude: 28.59, longitude: 77.05 };

/** A second commuter watching the map, connected straight to the API. */
async function watchLiveMap() {
  const messages: ServerMessage[] = [];
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/api/v1/live`);
  ws.onmessage = (ev) => messages.push(JSON.parse(String(ev.data)) as ServerMessage);
  await new Promise((resolve) => (ws.onopen = resolve));
  ws.send(JSON.stringify({ type: 'subscribe.bbox', bbox: [77.19, 28.62, 77.26, 28.69] }));
  const crowd = () =>
    messages.flatMap((m) =>
      m.type === 'vehicle.position' && m.payload.source === 'crowd' ? [m.payload] : [],
    );
  const removed = () =>
    messages.flatMap((m) => (m.type === 'vehicle.removed' ? [m.payload.vehicleId] : []));
  return { crowd, removed, close: () => ws.close() };
}

test.describe('sharing a ride', () => {
  test('a rider on KG-1 appears on everyone’s map and leaves it when they stop', async ({
    isolated: page,
  }) => {
    const watcher = await watchLiveMap();
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ ...ON_KG1, accuracy: 10 });
    await page.goto(planUrl(KG_METRO, CC_MARKET));

    const first = page.getByRole('article').first();
    await first.getByRole('button', { name: /I’m on this shared auto/ }).click();
    // Nothing is shared before the rider confirms.
    await expect(first.getByText('Share where this shared auto is?')).toBeVisible();
    expect(watcher.crowd()).toHaveLength(0);
    await first.getByRole('button', { name: 'Start sharing' }).click();

    const banner = page.getByRole('region', { name: 'Sharing your ride' });
    await expect(banner).toContainText('Sharing your ride on KG-1');
    await expect(banner).toContainText('Others can see this vehicle on the map.');
    await expect(first.getByText('Sharing this ride')).toBeVisible();
    await expect.poll(() => watcher.crowd().length).toBeGreaterThan(0);
    const vehicle = watcher.crowd()[0]!;
    expect(vehicle).toMatchObject({ routeId: 'KG-1', mode: 'AUTO_RICKSHAW' });

    await banner.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Thanks for sharing your ride.')).toBeVisible();
    await expect.poll(() => watcher.removed()).toContain(vehicle.vehicleId);
    watcher.close();
  });

  test('tells the rider when they are not on the route they picked', async ({ isolated: page }) => {
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ ...FAR_AWAY, accuracy: 10 });
    await page.goto(planUrl(KG_METRO, CC_MARKET));

    const first = page.getByRole('article').first();
    await first.getByRole('button', { name: /I’m on this shared auto/ }).click();
    await first.getByRole('button', { name: 'Start sharing' }).click();
    const banner = page.getByRole('region', { name: 'Sharing your ride' });
    await expect(banner).toContainText("You're not on this route's path");
    await banner.getByRole('button', { name: 'Stop' }).click();
  });
});
