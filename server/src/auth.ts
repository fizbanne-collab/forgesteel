import cookie from '@fastify/cookie';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppConfig } from './config.js';
import { DatabasePool } from './db.js';
import { createCodeChallenge, createToken, hashToken } from './security.js';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = [ 'https://accounts.google.com', 'accounts.google.com' ];
const SESSION_COOKIE = 'stravsteel_session';
const OAUTH_COOKIE = 'stravsteel_oauth';
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface AuthenticatedUser {
	id: string;
	email: string;
	displayName: string;
	avatarUrl: string | null;
	siteRole: 'admin' | 'player';
}

interface OAuthState {
	state: string;
	verifier: string;
	invite?: string;
}

interface GoogleClaims {
	sub: string;
	email: string;
	email_verified: boolean;
	name?: string;
	picture?: string;
}

const cookieOptions = (config: AppConfig) => ({
	httpOnly: true,
	path: '/',
	sameSite: 'lax' as const,
	secure: config.COOKIE_SECURE,
	signed: true
});

const encodeState = (state: OAuthState) => {
	return Buffer.from(JSON.stringify(state)).toString('base64url');
};

const decodeState = (value: string): OAuthState => {
	return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as OAuthState;
};

export const getSessionUser = async (
	request: FastifyRequest,
	database: DatabasePool
): Promise<AuthenticatedUser | null> => {
	const signedToken = request.cookies[SESSION_COOKIE];
	if (!signedToken) {
		return null;
	}
	const token = request.unsignCookie(signedToken);
	if (!token.valid || !token.value) {
		return null;
	}

	const result = await database.query<{
		id: string;
		email: string;
		display_name: string;
		avatar_url: string | null;
		site_role: 'admin' | 'player';
	}>(`
		select u.id, u.email, u.display_name, u.avatar_url, u.site_role
		from auth_session s
		join app_user u on u.id = s.user_id
		where s.token_hash = $1 and s.expires_at > now()
	`, [ hashToken(token.value) ]);

	const user = result.rows[0];
	return user ? {
		id: user.id,
		email: user.email,
		displayName: user.display_name,
		avatarUrl: user.avatar_url,
		siteRole: user.site_role
	} : null;
};

export const requireUser = async (
	request: FastifyRequest,
	reply: FastifyReply,
	database: DatabasePool
) => {
	const user = await getSessionUser(request, database);
	if (!user) {
		await reply.code(401).send({ error: 'Authentication required' });
		return null;
	}
	return user;
};

const admitGoogleUser = async (
	database: DatabasePool,
	config: AppConfig,
	claims: GoogleClaims,
	inviteToken?: string
) => {
	const client = await database.connect();
	try {
		await client.query('begin');
		const existing = await client.query<{ id: string }>(`
			select id from app_user
			where google_subject = $1 or lower(email) = lower($2)
			limit 1
		`, [ claims.sub, claims.email ]);

		let userId = existing.rows[0]?.id;
		let invitation: { id: string; campaign_id: string | null; role: 'director' | 'player' } | undefined;

		if (!userId) {
			const invitationResult = await client.query<{
				id: string;
				campaign_id: string | null;
				role: 'director' | 'player';
			}>(`
				select id, campaign_id, role
				from invitation
				where accepted_at is null
					and (expires_at is null or expires_at > now())
					and (
						(email is not null and lower(email) = lower($1))
						or ($2::text is not null and token_hash = $2)
					)
				order by campaign_id nulls first, created_at
				limit 1
				for update
			`, [ claims.email, inviteToken ? hashToken(inviteToken) : null ]);
			invitation = invitationResult.rows[0];

			const isInitialAdmin = claims.email.toLowerCase() === config.INITIAL_ADMIN_EMAIL.toLowerCase();
			if (!isInitialAdmin && !invitation) {
				throw new Error('INVITE_REQUIRED');
			}

			const inserted = await client.query<{ id: string }>(`
				insert into app_user (google_subject, email, display_name, avatar_url, site_role)
				values ($1, $2, $3, $4, $5)
				returning id
			`, [
				claims.sub,
				claims.email,
				claims.name ?? claims.email,
				claims.picture ?? null,
				isInitialAdmin ? 'admin' : 'player'
			]);
			userId = inserted.rows[0].id;
		} else {
			await client.query(`
				update app_user
				set google_subject = $2, email = $3, display_name = $4,
					avatar_url = $5,
					site_role = case when lower($3) = lower($6) then 'admin' else site_role end,
					updated_at = now()
				where id = $1
			`, [
				userId,
				claims.sub,
				claims.email,
				claims.name ?? claims.email,
				claims.picture ?? null,
				config.INITIAL_ADMIN_EMAIL
			]);
		}

		if (invitation) {
			await client.query(`
				update invitation
				set accepted_at = now(), accepted_by = $2
				where id = $1
			`, [ invitation.id, userId ]);
			if (invitation.campaign_id) {
				await client.query(`
					insert into campaign_member (campaign_id, user_id, role)
					values ($1, $2, $3)
					on conflict (campaign_id, user_id) do update set role = excluded.role
				`, [ invitation.campaign_id, userId, invitation.role ]);
			}
		}

		await client.query('commit');
		return userId;
	} catch (error) {
		await client.query('rollback');
		throw error;
	} finally {
		client.release();
	}
};

export const registerAuth = async (
	app: FastifyInstance,
	config: AppConfig,
	database: DatabasePool
) => {
	await app.register(cookie, { secret: config.SESSION_SECRET });

	app.get('/api/auth/google', async (request, reply) => {
		if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
			return reply.code(503).send({ error: 'Google authentication is not configured' });
		}

		const query = request.query as { invite?: string };
		const state: OAuthState = {
			state: createToken(),
			verifier: createToken(48),
			invite: query.invite
		};
		reply.setCookie(OAUTH_COOKIE, encodeState(state), {
			...cookieOptions(config),
			maxAge: 600
		});

		const parameters = new URLSearchParams({
			client_id: config.GOOGLE_CLIENT_ID,
			redirect_uri: config.GOOGLE_CALLBACK_URL,
			response_type: 'code',
			scope: 'openid email profile',
			state: state.state,
			code_challenge: createCodeChallenge(state.verifier),
			code_challenge_method: 'S256',
			prompt: 'select_account'
		});
		return reply.redirect(`${GOOGLE_AUTHORIZATION_URL}?${parameters}`);
	});

	app.get('/api/auth/google/callback', async (request, reply) => {
		const query = request.query as { code?: string; state?: string; error?: string };
		const signedState = request.cookies[OAUTH_COOKIE];
		reply.clearCookie(OAUTH_COOKIE, { path: '/' });
		if (query.error || !query.code || !query.state || !signedState) {
			return reply.redirect(`${config.WEB_ORIGIN}/?auth=failed`);
		}

		const unsigned = request.unsignCookie(signedState);
		if (!unsigned.valid || !unsigned.value) {
			return reply.code(400).send({ error: 'Invalid OAuth state cookie' });
		}
		const oauthState = decodeState(unsigned.value);
		if (oauthState.state !== query.state) {
			return reply.code(400).send({ error: 'Invalid OAuth state' });
		}

		const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code: query.code,
				client_id: config.GOOGLE_CLIENT_ID,
				client_secret: config.GOOGLE_CLIENT_SECRET,
				redirect_uri: config.GOOGLE_CALLBACK_URL,
				grant_type: 'authorization_code',
				code_verifier: oauthState.verifier
			})
		});
		if (!tokenResponse.ok) {
			app.log.error({ status: tokenResponse.status }, 'Google token exchange failed');
			return reply.redirect(`${config.WEB_ORIGIN}/?auth=failed`);
		}
		const tokens = await tokenResponse.json() as { id_token?: string };
		if (!tokens.id_token) {
			return reply.redirect(`${config.WEB_ORIGIN}/?auth=failed`);
		}

		const verified = await jwtVerify(tokens.id_token, googleKeys, {
			audience: config.GOOGLE_CLIENT_ID,
			issuer: GOOGLE_ISSUERS
		});
		const claims = verified.payload as unknown as GoogleClaims;
		if (!claims.sub || !claims.email || !claims.email_verified) {
			return reply.code(403).send({ error: 'A verified Google email is required' });
		}

		try {
			const userId = await admitGoogleUser(database, config, claims, oauthState.invite);
			const sessionToken = createToken();
			await database.query(`
				insert into auth_session (user_id, token_hash, expires_at)
				values ($1, $2, now() + interval '30 days')
			`, [ userId, hashToken(sessionToken) ]);
			reply.setCookie(SESSION_COOKIE, sessionToken, {
				...cookieOptions(config),
				maxAge: SESSION_DURATION_SECONDS
			});
			return reply.redirect(config.WEB_ORIGIN);
		} catch (error) {
			if (error instanceof Error && error.message === 'INVITE_REQUIRED') {
				return reply.redirect(`${config.WEB_ORIGIN}/?auth=invite-required`);
			}
			throw error;
		}
	});

	app.get('/api/auth/session', async (request, reply) => {
		const user = await getSessionUser(request, database);
		return user ?? reply.code(401).send({ error: 'Authentication required' });
	});

	app.post('/api/auth/logout', async (request, reply) => {
		const signedToken = request.cookies[SESSION_COOKIE];
		if (signedToken) {
			const token = request.unsignCookie(signedToken);
			if (token.valid && token.value) {
				await database.query('delete from auth_session where token_hash = $1', [ hashToken(token.value) ]);
			}
		}
		reply.clearCookie(SESSION_COOKIE, { path: '/' });
		return reply.code(204).send();
	});
};
