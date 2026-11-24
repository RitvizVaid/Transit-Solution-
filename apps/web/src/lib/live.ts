import type {
  ClientMessage,
  ServerMessage,
  StandStatus,
  VehiclePosition,
} from '@transit/shared-types';
import { config } from '../config';

type BBox = [west: number, south: number, east: number, north: number];
type Listener<T> = (value: T) => void;

/** ws(s)://host/api/v1/live, following VITE_API_BASE when the API is on another origin. */
export function liveUrl(apiBase: string, location: Pick<Location, 'protocol' | 'host'>): string {
  if (apiBase) return `${apiBase.replace(/^http/, 'ws')}/api/v1/live`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/live`;
}

/** Reconnect delay: 1 s, 2 s, 4 s … capped at 30 s, with ±20 % jitter. */
export function backoffMs(attempt: number, rand = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.8 + rand() * 0.4));
}

/**
 * One WebSocket for the whole app. Components declare what they want (stand ids,
 * a map viewport); the connection re-sends those after every reconnect.
 */
class LiveConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private standIds = new Set<string>();
  private bbox: BBox | null = null;
  private readonly standListeners = new Set<Listener<StandStatus>>();
  private readonly vehicleListeners = new Set<Listener<VehiclePosition>>();
  private readonly removedListeners = new Set<Listener<string>>();
  private readonly vehicleSourceListeners = new Set<
    Listener<Extract<ServerMessage, { type: 'vehicle.source.status' }>['payload']>
  >();
  private readonly openListeners = new Set<Listener<boolean>>();
  private wanted = 0;

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Reference-counted: the socket stays up while anyone needs it. */
  retain(): () => void {
    this.wanted += 1;
    this.connect();
    return () => {
      this.wanted -= 1;
      if (this.wanted === 0) this.disconnect();
    };
  }

  private connect() {
    if (this.ws || typeof WebSocket === 'undefined') return;
    const ws = new WebSocket(liveUrl(config.apiBase, window.location));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.resubscribe();
      this.openListeners.forEach((l) => l(true));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'stand.status') this.standListeners.forEach((l) => l(msg.payload));
      else if (msg.type === 'vehicle.position')
        this.vehicleListeners.forEach((l) => l(msg.payload));
      else if (msg.type === 'vehicle.removed')
        this.removedListeners.forEach((l) => l(msg.payload.vehicleId));
      else if (msg.type === 'vehicle.source.status')
        this.vehicleSourceListeners.forEach((l) => l(msg.payload));
    };
    ws.onclose = () => {
      this.ws = null;
      this.openListeners.forEach((l) => l(false));
      if (this.wanted > 0) {
        this.timer = setTimeout(() => this.connect(), backoffMs(this.attempt++));
      }
    };
    ws.onerror = () => ws.close();
  }

  private disconnect() {
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private send(msg: ClientMessage) {
    if (this.isOpen) this.ws!.send(JSON.stringify(msg));
  }

  private resubscribe() {
    if (this.standIds.size) this.send({ type: 'subscribe.stands', standIds: [...this.standIds] });
    if (this.bbox) this.send({ type: 'subscribe.bbox', bbox: this.bbox });
  }

  setStands(ids: Iterable<string>) {
    this.standIds = new Set(ids);
    this.send({ type: 'subscribe.stands', standIds: [...this.standIds] });
  }

  setBbox(bbox: BBox | null) {
    this.bbox = bbox;
    if (bbox) this.send({ type: 'subscribe.bbox', bbox });
  }

  onStand(l: Listener<StandStatus>) {
    this.standListeners.add(l);
    return () => void this.standListeners.delete(l);
  }

  onVehicle(l: Listener<VehiclePosition>) {
    this.vehicleListeners.add(l);
    return () => void this.vehicleListeners.delete(l);
  }

  /** A vehicle left the map (its rider stopped sharing). */
  onVehicleRemoved(l: Listener<string>) {
    this.removedListeners.add(l);
    return () => void this.removedListeners.delete(l);
  }

  onVehicleSourceStatus(
    l: Listener<Extract<ServerMessage, { type: 'vehicle.source.status' }>['payload']>,
  ) {
    this.vehicleSourceListeners.add(l);
    return () => void this.vehicleSourceListeners.delete(l);
  }

  onOpenChange(l: Listener<boolean>) {
    this.openListeners.add(l);
    return () => void this.openListeners.delete(l);
  }
}

export const live = new LiveConnection();
