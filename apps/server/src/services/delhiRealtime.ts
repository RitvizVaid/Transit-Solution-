import { createHash } from 'node:crypto';
import { DELHI_POSITION_MAX_AGE_MS, type VehiclePosition } from '@transit/shared-types';
import gtfsRealtime from 'gtfs-realtime-bindings';

const ENDPOINT = 'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb';
const POLL_MS = 30_000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

async function readFeed(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    throw new Error('Invalid feed response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Feed response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function decodeDelhiPositions(bytes: Uint8Array, now: number): VehiclePosition[] {
  const feed = gtfsRealtime.transit_realtime.FeedMessage.decode(bytes);
  if (
    feed.header.incrementality ===
    gtfsRealtime.transit_realtime.FeedHeader.Incrementality.DIFFERENTIAL
  ) {
    throw new Error('Differential GTFS-Realtime feeds are not supported');
  }
  const positions: VehiclePosition[] = [];
  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;
    const point = vehicle?.position;
    if (!vehicle || !point || entity.isDeleted || vehicle.timestamp == null || !entity.id) continue;
    const timestamp = Number(vehicle.timestamp) * 1000;
    if (
      !Number.isFinite(timestamp) ||
      timestamp < now - DELHI_POSITION_MAX_AGE_MS ||
      timestamp > now + 30_000 ||
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.latitude) > 90 ||
      Math.abs(point.longitude) > 180
    )
      continue;
    positions.push({
      vehicleId: `otd-${createHash('sha256').update(entity.id).digest('hex')}`,
      source: 'delhi-otd',
      mode: 'BUS',
      coordinates: [point.longitude, point.latitude],
      timestamp: new Date(timestamp).toISOString(),
    });
  }
  return positions;
}

export class DelhiRealtime {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private stopped = true;
  status: 'starting' | 'ok' | 'error' = 'starting';
  lastSuccess: string | null = null;

  constructor(
    private readonly key: string,
    private readonly publish: (positions: VehiclePosition[]) => void,
    private readonly publishStatus: (status: 'starting' | 'ok' | 'error') => void,
    private readonly warn: (message: string) => void,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.stopped = false;
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
  }

  private async poll(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set('key', this.key);
      const response = await this.fetchImpl(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        this.warn(`Delhi real-time vehicle feed returned HTTP ${response.status}`);
        throw new Error('Feed request failed');
      }
      const positions = decodeDelhiPositions(await readFeed(response), this.now());
      if (this.stopped) return;
      this.publish(positions);
      this.status = 'ok';
      this.lastSuccess = new Date(this.now()).toISOString();
      this.publishStatus(this.status);
    } catch {
      if (!this.stopped) {
        this.status = 'error';
        this.publish([]);
        this.publishStatus(this.status);
        // Request errors may contain the secret-bearing URL.
        this.warn('Delhi real-time vehicle feed failed; check access and provider status');
      }
    } finally {
      clearTimeout(timeout);
      this.controller = undefined;
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.poll(), POLL_MS);
        this.timer.unref();
      }
    }
  }
}
