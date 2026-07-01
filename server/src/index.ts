import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabasePool } from './db.js';

const start = async () => {
	const config = loadConfig();
	const database = createDatabasePool(config.DATABASE_URL);
	const app = await buildApp({ config, database });

	try {
		await app.listen({
			host: config.HOST,
			port: config.PORT
		});
	} catch (error) {
		app.log.error(error);
		process.exitCode = 1;
	}
};

await start();
