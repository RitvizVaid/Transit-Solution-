import type { FastifyPluginAsync } from 'fastify';

/**
 * WebSocket: client sends `ClientMessage`s (subscribe.bbox / subscribe.stands /
 * unsubscribe) and receives `ServerMessage`s (vehicle.position / stand.status).
 */
export const liveRoutes: FastifyPluginAsync = async (app) => {
  app.get('/live', { websocket: true, schema: { hide: true } }, (socket) => {
    const session = app.transit.hub.connect(socket);
    socket.on('message', (data: Buffer) => session.onMessage(data.toString()));
    socket.on('close', session.close);
    socket.on('error', session.close);
  });
};
