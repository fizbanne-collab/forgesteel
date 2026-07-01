import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { registerCampaigns } from './campaigns.js';
import { registerStorage } from './storage.js';
import { AppConfig } from './config.js';
import { DatabasePool } from './db.js';

interface AppDependencies {
	config: AppConfig;
	database: DatabasePool;
}

export const buildApp = async ({ config, database }: AppDependencies) => {
	const app = Fastify({
		logger: config.NODE_ENV !== 'test',
		trustProxy: true
	});

	await app.register(cors, {
		origin: config.WEB_ORIGIN,
		credentials: true
	});
	await app.register(websocket);
	await registerAuth(app, config, database);
	registerCampaigns(app, config, database);
	registerStorage(app, database);

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

	app.get('/api/realtime', { websocket: true }, socket => {
		socket.send(JSON.stringify({
			type: 'connected',
			message: 'Authentication and character rooms will be added in the next phase.'
		}));

		socket.on('message', (message: Buffer) => {
			if (message.toString() === 'ping') {
				socket.send('pong');
			}
		});
	});

	app.addHook('onClose', async () => {
		await database.end();
	});

	return app;
};
