import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { registerCampaigns } from './campaigns.js';
import { registerStorage } from './storage.js';
import { RealtimeHub, registerRealtime } from './realtime.js';
import { registerFiles } from './files.js';
import { AppConfig } from './config.js';
import { DatabasePool } from './db.js';

interface AppDependencies {
	config: AppConfig;
	database: DatabasePool;
}

export const buildApp = async ({ config, database }: AppDependencies) => {
	const app = Fastify({
		bodyLimit: 2 * 1024 * 1024,
		logger: config.NODE_ENV !== 'test',
		trustProxy: true
	});

	await app.register(rateLimit, {
		global: true,
		max: config.RATE_LIMIT_MAX,
		timeWindow: config.RATE_LIMIT_WINDOW,
		allowList: request => request.url === '/api/health'
	});
	await app.register(cors, {
		origin: config.WEB_ORIGIN,
		credentials: true
	});
	await app.register(websocket);
	await registerAuth(app, config, database);
	registerCampaigns(app, config, database);
	const realtime = new RealtimeHub();
	registerRealtime(app, database, realtime);
	registerStorage(app, database, realtime);
	await registerFiles(app, config, database);

	app.get('/api/health', async (_request, reply) => {
		try {
			await database.query('select 1');
			return {
				status: 'healthy',
				service: 'stravsteel-api'
			};
		} catch (error) {
			app.log.error(error);
			return reply.code(503).send({
				status: 'unhealthy',
				service: 'stravsteel-api'
			});
		}
	});

	app.addHook('onClose', async () => {
		await database.end();
	});

	return app;
};
