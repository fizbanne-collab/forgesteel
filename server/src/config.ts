import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
	NODE_ENV: z.enum([ 'development', 'test', 'production' ]).default('development'),
	HOST: z.string().default('0.0.0.0'),
	PORT: z.coerce.number().int().positive().default(3001),
	DATABASE_URL: z.string().min(1),
	WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
	SESSION_SECRET: z.string().min(32),
	COOKIE_SECURE: z.enum([ 'true', 'false' ]).default('false').transform(value => value === 'true'),
	GOOGLE_CLIENT_ID: z.string().default(''),
	GOOGLE_CLIENT_SECRET: z.string().default(''),
	GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:3001/api/auth/google/callback'),
	INITIAL_ADMIN_EMAIL: z.string().email().or(z.literal('')).default(''),
	UPLOAD_DIRECTORY: z.string().default('./storage/uploads'),
	RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
	RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute')
});

export type AppConfig = z.infer<typeof configSchema>;

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): AppConfig => {
	const result = configSchema.safeParse(environment);
	if (!result.success) {
		const details = result.error.issues
			.map(issue => `${issue.path.join('.')}: ${issue.message}`)
			.join(', ');
		throw new Error(`Invalid StravSteel configuration: ${details}`);
	}
	return result.data;
};
