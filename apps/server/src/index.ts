import { buildApp } from './app.js';

const app = await buildApp({ logger: true });
const { port, host } = app.transit.config;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host });
  app.log.info(`API docs at http://localhost:${port}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
