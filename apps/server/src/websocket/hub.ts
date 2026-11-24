import type {
  ClientMessage,
  ServerMessage,
  StandStatus,
  VehiclePosition,
} from '@transit/shared-types';

type BBox = [west: number, south: number, east: number, north: number];

export interface LiveSocket {
  send(data: string): void;
  readonly readyState: number;
}

interface Client {
  socket: LiveSocket;
  bbox: BBox | null;
  standIds: Set<string> | null;
}

const OPEN = 1;
const inBox = ([lng, lat]: [number, number], [w, s, e, n]: BBox) =>
  lng >= w && lng <= e && lat >= s && lat <= n;

/**
 * Fan-out for /api/v1/live. Clients subscribe to a map viewport (vehicles + stands
 * inside it) and/or to specific stands (itinerary cards). Messages are the
 * `ServerMessage` union from shared-types.
 */
export class LiveHub {
  private readonly clients = new Set<Client>();
  private vehicles: VehiclePosition[] = [];

  constructor(private readonly standSnapshot: () => StandStatus[]) {}

  get size(): number {
    return this.clients.size;
  }

  connect(socket: LiveSocket): { onMessage: (raw: string) => void; close: () => void } {
    const client: Client = { socket, bbox: null, standIds: null };
    this.clients.add(client);
    return {
      onMessage: (raw) => this.handle(client, raw),
      close: () => this.clients.delete(client),
    };
  }

  private send(client: Client, msg: ServerMessage) {
    if (client.socket.readyState === OPEN) client.socket.send(JSON.stringify(msg));
  }

  private handle(client: Client, raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'subscribe.bbox': {
        const b = msg.bbox;
        if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return;
        client.bbox = b;
        for (const s of this.standSnapshot())
          if (inBox(s.coordinates, b)) this.send(client, { type: 'stand.status', payload: s });
        for (const v of this.vehicles)
          if (inBox(v.coordinates, b)) this.send(client, { type: 'vehicle.position', payload: v });
        break;
      }
      case 'subscribe.stands': {
        if (!Array.isArray(msg.standIds)) return;
        client.standIds = new Set(msg.standIds.slice(0, 100).map(String));
        for (const s of this.standSnapshot())
          if (client.standIds.has(s.standId))
            this.send(client, { type: 'stand.status', payload: s });
        break;
      }
      case 'unsubscribe':
        client.bbox = null;
        client.standIds = null;
        break;
    }
  }

  publishStand(status: StandStatus) {
    for (const c of this.clients) {
      if (c.standIds?.has(status.standId) || (c.bbox && inBox(status.coordinates, c.bbox))) {
        this.send(c, { type: 'stand.status', payload: status });
      }
    }
  }

  /** One vehicle moved (e.g. a rider's phone reported); sent at once, not on the next tick. */
  publishVehicle(v: VehiclePosition) {
    this.vehicles = [...this.vehicles.filter((x) => x.vehicleId !== v.vehicleId), v];
    for (const c of this.clients) {
      if (c.bbox && inBox(v.coordinates, c.bbox))
        this.send(c, { type: 'vehicle.position', payload: v });
    }
  }

  removeVehicle(vehicleId: string) {
    this.vehicles = this.vehicles.filter((v) => v.vehicleId !== vehicleId);
    for (const c of this.clients) {
      if (c.bbox) this.send(c, { type: 'vehicle.removed', payload: { vehicleId } });
    }
  }

  /** Replaces the full vehicle snapshot (sent to new subscribers) and pushes it. */
  publishVehicles(positions: VehiclePosition[]) {
    this.vehicles = positions;
    for (const c of this.clients) {
      if (!c.bbox) continue;
      for (const v of positions)
        if (inBox(v.coordinates, c.bbox)) this.send(c, { type: 'vehicle.position', payload: v });
    }
  }
}
