/** The fields these tests read from GET /api/v1/stands/:id (see StandStatus in shared-types). */
interface StandStatus {
  passengerQueueLevel: string;
  lastUpdated: string;
}
import { API } from './playwright.config';
import { DRIVER, expect, REPORT_TOKENS, test } from './fixtures';

const standStatus = async (request: import('@playwright/test').APIRequestContext, id: string) =>
  (await (await request.get(`${API}/api/v1/stands/${id}`)).json()) as StandStatus;

const authorize = async (
  page: import('@playwright/test').Page,
  standId: keyof typeof REPORT_TOKENS,
) => {
  await page.getByLabel('Stand reporting code').fill(REPORT_TOKENS[standId]);
  await page.getByRole('button', { name: 'Verify stand code' }).click();
};

test.describe('driver / marshal portal', () => {
  test('pick a stand from the list and report a crowd', async ({ page, request }) => {
    await page.goto(DRIVER);
    await page.getByRole('button', { name: 'Old Delhi Railway Station' }).click();
    await expect(page).toHaveURL(/stand=odrs-1/);
    await authorize(page, 'odrs-1');
    await page.getByRole('button', { name: /20\+ people waiting/ }).click();
    await expect(page.getByText('Sent: 20+ people waiting')).toBeVisible();
    await expect
      .poll(async () => (await standStatus(request, 'odrs-1')).passengerQueueLevel)
      .toBe('severe');
    // The marshal sees the result of their own report, pushed back live.
    await expect(page.getByLabel('Current stand status')).toContainText('Very crowded');
  });

  test('reports made offline are queued and sent when back online', async ({
    page,
    context,
    request,
  }) => {
    await page.goto(`${DRIVER}/?stand=jama-masjid-g1`);
    await expect(page.getByRole('heading', { name: 'Jama Masjid Gate 1' })).toBeVisible();
    await authorize(page, 'jama-masjid-g1');
    const before = await standStatus(request, 'jama-masjid-g1');

    await context.setOffline(true);
    await page.getByRole('button', { name: /No passengers/ }).click();
    await expect(page.getByText('Saved on this device. Will send when connected.')).toBeVisible();
    await expect(page.getByText('1 report waiting to send.')).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/report.* waiting to send/)).toBeHidden({ timeout: 10_000 });
    await expect
      .poll(async () => (await standStatus(request, 'jama-masjid-g1')).lastUpdated)
      .not.toBe(before.lastUpdated);
    expect((await standStatus(request, 'jama-masjid-g1')).passengerQueueLevel).toBe('empty');
  });

  test('an unknown stand from a bad QR code is explained', async ({ page }) => {
    await page.goto(`${DRIVER}/?stand=does-not-exist`);
    await expect(page.getByRole('alert')).toContainText('Unknown stand');
    await page.getByRole('button', { name: 'Choose a stand' }).click();
    await expect(page.getByRole('heading', { name: 'Choose your stand' })).toBeVisible();
  });

  test('a full offline queue warns the marshal and keeps earlier reports', async ({
    page,
    context,
  }) => {
    await page.goto(`${DRIVER}/?stand=odrs-1`);
    await authorize(page, 'odrs-1');
    const action = page.getByRole('button', { name: /No passengers/ });
    await expect(action).toBeEnabled();
    await context.setOffline(true);
    const ids = await page.evaluate(() => {
      const reports = Array.from({ length: 50 }, (_, index) => {
        const id = `offline-queue-${index}`;
        return {
          id,
          attempts: 0,
          report: {
            reportId: id,
            standId: 'odrs-1',
            kind: 'STAND_FULL',
            reportedAt: new Date().toISOString(),
          },
        };
      });
      localStorage.setItem('driver.reportQueue.v1', JSON.stringify(reports));
      return reports.map(({ id }) => id);
    });
    await action.click();
    await expect(page.getByText(/The report queue was full/)).toBeVisible();
    const remaining = await page.evaluate(() =>
      (JSON.parse(localStorage.getItem('driver.reportQueue.v1') ?? '[]') as { id: string }[]).map(
        ({ id }) => id,
      ),
    );
    expect(remaining).toEqual(ids);
  });
});
