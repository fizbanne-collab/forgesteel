import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDatabasePool } from './db.js';

const migrationDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const config = loadConfig();
const database = createDatabasePool(config.DATABASE_URL);

try {
	await database.query(`
		create table if not exists schema_migration (
			name text primary key,
			applied_at timestamptz not null default now()
		)
	`);

	const files = (await readdir(migrationDirectory))
		.filter(file => file.endsWith('.sql'))
		.sort();

	for (const file of files) {
		const existing = await database.query(
			'select 1 from schema_migration where name = $1',
			[ file ]
		);
		if (existing.rowCount) {
			continue;
		}

		const client = await database.connect();
		try {
			await client.query('begin');
			await client.query(await readFile(resolve(migrationDirectory, file), 'utf8'));
			await client.query('insert into schema_migration (name) values ($1)', [ file ]);
			await client.query('commit');
			console.warn(`Applied migration ${file}`);
		} catch (error) {
			await client.query('rollback');
			throw error;
		} finally {
			client.release();
		}
	}
} finally {
	await database.end();
}
