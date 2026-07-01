import pg from 'pg';

const { Pool } = pg;

export const createDatabasePool = (connectionString: string) => {
	return new Pool({
		connectionString,
		max: 10,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000
	});
};

export type DatabasePool = ReturnType<typeof createDatabasePool>;
