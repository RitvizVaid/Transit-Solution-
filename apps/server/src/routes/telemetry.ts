import { createHash, timingSafeEqual } from 'node:crypto';
import { REPORT_KINDS, type StandReport } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import { limitByIp, tooMany } from '../services/rateLimit.js';

export const telemetryRoutes: FastifyPluginAsync = async (app) => {
  const credentials = Object.entries(app.transit.config.reportTokenHashes).map(
    ([standId, hash]) => ({
      standId,
      hash: Buffer.from(hash, 'hex'),
    }),
  );
  const authorizedStand = (authorization: string | undefined) => {
    const token = /^Bearer ([^\s]+)$/.exec(authorization ?? '')?.[1];
    if (!token) return null;
    const digest = createHash('sha256').update(token).digest();
    return (
      credentials.find((credential) => timingSafeEqual(credential.hash, digest))?.standId ?? null
    );
  };

  app.post<{ Reply: { standId: string } | { error: string } }>(
    '/telemetry/session',
    {
      onRequest: limitByIp(() => app.transit.limits?.session),
      schema: {
        tags: ['live'],
        summary: 'Verify a stand-specific reporting token',
      },
    },
    async (req, reply) => {
      if (credentials.length === 0)
        return reply.code(503).send({ error: 'reporting_not_configured' });
      const standId = authorizedStand(req.headers.authorization);
      if (!standId) return reply.code(401).send({ error: 'invalid_report_token' });
      if (!app.transit.stands.has(standId))
        return reply.code(503).send({ error: 'report_token_stand_not_found' });
      return { standId };
    },
  );

  app.post<{ Body: StandReport }>(
    '/telemetry/reports',
    {
      schema: {
        tags: ['live'],
        summary: 'Driver / marshal report from a stand',
        description: 'Updates the stand state and pushes `stand.status` to live subscribers.',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['reportId', 'standId', 'kind', 'reportedAt'],
          properties: {
            reportId: { type: 'string', minLength: 1, maxLength: 64 },
            standId: { type: 'string', minLength: 1, maxLength: 64 },
            kind: { type: 'string', enum: [...REPORT_KINDS] },
            passengerCount: { type: 'integer', minimum: 0, maximum: 500 },
            reportedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (req, reply) => {
      const { stands, reports, now } = app.transit;
      if (credentials.length === 0)
        return reply.code(503).send({ error: 'reporting_not_configured' });
      const authorized = authorizedStand(req.headers.authorization);
      if (!authorized) return reply.code(401).send({ error: 'invalid_report_token' });
      if (authorized !== req.body.standId)
        return reply.code(403).send({ error: 'report_stand_forbidden' });
      // One stand's code cannot flood the live map (a marshal reports a few times a minute).
      const perStand = app.transit.limits?.reportsPerStand;
      if (perStand && !perStand.hit(authorized)) return tooMany(reply, perStand);
      if (!stands.has(req.body.standId)) return reply.code(404).send({ error: 'stand_not_found' });

      const receivedAt = now();
      const parsedAt = Date.parse(req.body.reportedAt);
      const reportedAt =
        parsedAt > receivedAt + 60_000 ? new Date(receivedAt).toISOString() : req.body.reportedAt;
      const report = { ...req.body, reportedAt };
      const result = reports.record(report, receivedAt, () => stands.apply(report), req.body);

      if (result.status === 'conflict')
        return reply.code(409).send({ error: 'report_id_conflict' });
      if (result.status === 'out_of_order')
        return reply.code(409).send({ error: 'report_out_of_order' });
      if (result.status === 'expired') return reply.code(410).send({ error: 'report_expired' });

      const stand = stands.get(report.standId);
      if (!stand) throw new Error(`stand disappeared after accepting report ${report.reportId}`);
      if (result.status === 'accepted') {
        req.log.info(
          { reportId: report.reportId, standId: stand.standId, kind: report.kind },
          'stand report',
        );
      }
      return reply.code(result.status === 'accepted' ? 202 : 200).send({
        accepted: true,
        duplicate: result.status === 'duplicate',
        stand,
      });
    },
  );
};
