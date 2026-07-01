import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppConfig } from './config.js';
import { DatabasePool } from './db.js';
import { requireUser } from './auth.js';
import { createToken, hashToken } from './security.js';

const campaignSchema = z.object({
	name: z.string().trim().min(1).max(120)
});

const invitationSchema = z.object({
	email: z.string().email().optional(),
	role: z.enum([ 'director', 'player' ]).default('player'),
	mode: z.enum([ 'email', 'link' ])
}).refine(value => value.mode !== 'email' || value.email, {
	message: 'Email is required for an email invitation'
});

const memberRoleSchema = z.object({
	role: z.enum([ 'director', 'player' ])
});

export const registerCampaigns = (
	app: FastifyInstance,
	config: AppConfig,
	database: DatabasePool
) => {
	const canManageCampaign = async (campaignId: string, userId: string, isAdmin: boolean) => {
		if (isAdmin) {
			return true;
		}
		const authorization = await database.query(`
			select 1 from campaign_member
			where campaign_id = $1 and user_id = $2 and role = 'director'
		`, [ campaignId, userId ]);
		return Boolean(authorization.rowCount);
	};

	const isLastDirector = async (campaignId: string, userId: string) => {
		const result = await database.query<{ target_role: string; director_count: number }>(`
			select
				(select role from campaign_member where campaign_id = $1 and user_id = $2) as target_role,
				(select count(*)::int from campaign_member where campaign_id = $1 and role = 'director') as director_count
		`, [ campaignId, userId ]);
		return result.rows[0]?.target_role === 'director' && result.rows[0].director_count <= 1;
	};

	app.post('/api/invitations/:token/accept', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { token } = request.params as { token: string };
		const client = await database.connect();
		try {
			await client.query('begin');
			const invitation = await client.query<{
				id: string;
				campaign_id: string | null;
				role: 'director' | 'player';
			}>(`
				select id, campaign_id, role
				from invitation
				where token_hash = $1
					and accepted_at is null
					and (expires_at is null or expires_at > now())
					and (email is null or lower(email) = lower($2))
				for update
			`, [ hashToken(token), user.email ]);
			const match = invitation.rows[0];
			if (!match) {
				await client.query('rollback');
				return reply.code(404).send({ error: 'Invitation is invalid or expired' });
			}
			await client.query(`
				update invitation set accepted_at = now(), accepted_by = $2 where id = $1
			`, [ match.id, user.id ]);
			if (match.campaign_id) {
				await client.query(`
					insert into campaign_member (campaign_id, user_id, role)
					values ($1, $2, $3)
					on conflict (campaign_id, user_id) do update set role = excluded.role
				`, [ match.campaign_id, user.id, match.role ]);
			}
			await client.query('commit');
			return reply.code(204).send();
		} catch (error) {
			await client.query('rollback');
			throw error;
		} finally {
			client.release();
		}
	});

	app.get('/api/campaigns', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const result = await database.query(`
			select c.id, c.name, cm.role, c.created_at, c.updated_at
			from campaign c
			join campaign_member cm on cm.campaign_id = c.id
			where cm.user_id = $1
			order by lower(c.name)
		`, [ user.id ]);
		return result.rows;
	});

	app.post('/api/campaigns', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const parsed = campaignSchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.code(400).send({ error: parsed.error.flatten() });
		}

		const client = await database.connect();
		try {
			await client.query('begin');
			const campaign = await client.query<{ id: string; name: string }>(`
				insert into campaign (name, created_by)
				values ($1, $2)
				returning id, name
			`, [ parsed.data.name, user.id ]);
			await client.query(`
				insert into campaign_member (campaign_id, user_id, role)
				values ($1, $2, 'director')
			`, [ campaign.rows[0].id, user.id ]);
			await client.query('commit');
			return reply.code(201).send({ ...campaign.rows[0], role: 'director' });
		} catch (error) {
			await client.query('rollback');
			throw error;
		} finally {
			client.release();
		}
	});

	app.get('/api/campaigns/:campaignId/members', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { campaignId } = request.params as { campaignId: string };
		const membership = await database.query(`
			select 1 from campaign_member where campaign_id = $1 and user_id = $2
		`, [ campaignId, user.id ]);
		if (!membership.rowCount) {
			return reply.code(403).send({ error: 'Campaign access required' });
		}
		const result = await database.query(`
			select
				u.id,
				u.email,
				u.display_name as "displayName",
				u.avatar_url as "avatarUrl",
				cm.role
			from campaign_member cm
			join app_user u on u.id = cm.user_id
			where cm.campaign_id = $1
			order by cm.role, lower(u.display_name)
		`, [ campaignId ]);
		return result.rows;
	});

	app.patch('/api/campaigns/:campaignId/members/:memberId', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { campaignId, memberId } = request.params as { campaignId: string; memberId: string };
		if (!await canManageCampaign(campaignId, user.id, user.siteRole === 'admin')) {
			return reply.code(403).send({ error: 'Director access required' });
		}
		const parsed = memberRoleSchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.code(400).send({ error: parsed.error.flatten() });
		}
		if (parsed.data.role === 'player' && await isLastDirector(campaignId, memberId)) {
			return reply.code(409).send({ error: 'A campaign must retain at least one Director' });
		}
		const result = await database.query(`
			update campaign_member
			set role = $3
			where campaign_id = $1 and user_id = $2
			returning role
		`, [ campaignId, memberId, parsed.data.role ]);
		if (!result.rowCount) {
			return reply.code(404).send({ error: 'Campaign member not found' });
		}
		return result.rows[0];
	});

	app.delete('/api/campaigns/:campaignId/members/:memberId', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { campaignId, memberId } = request.params as { campaignId: string; memberId: string };
		if (!await canManageCampaign(campaignId, user.id, user.siteRole === 'admin')) {
			return reply.code(403).send({ error: 'Director access required' });
		}
		if (await isLastDirector(campaignId, memberId)) {
			return reply.code(409).send({ error: 'A campaign must retain at least one Director' });
		}

		const client = await database.connect();
		try {
			await client.query('begin');
			await client.query(`
				update character set owner_id = null, updated_at = now()
				where campaign_id = $1 and owner_id = $2
			`, [ campaignId, memberId ]);
			const result = await client.query(`
				delete from campaign_member
				where campaign_id = $1 and user_id = $2
			`, [ campaignId, memberId ]);
			if (!result.rowCount) {
				await client.query('rollback');
				return reply.code(404).send({ error: 'Campaign member not found' });
			}
			await client.query('commit');
			return reply.code(204).send();
		} catch (error) {
			await client.query('rollback');
			throw error;
		} finally {
			client.release();
		}
	});

	app.post('/api/campaigns/:campaignId/invitations', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { campaignId } = request.params as { campaignId: string };
		if (!await canManageCampaign(campaignId, user.id, user.siteRole === 'admin')) {
			return reply.code(403).send({ error: 'Director access required' });
		}

		const parsed = invitationSchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.code(400).send({ error: parsed.error.flatten() });
		}
		const token = parsed.data.mode === 'link' ? createToken() : undefined;
		const result = await database.query<{ id: string }>(`
			insert into invitation (
				campaign_id, email, token_hash, role, created_by, expires_at
			)
			values ($1, $2, $3, $4, $5, now() + interval '7 days')
			returning id
		`, [
			campaignId,
			parsed.data.email ?? null,
			token ? hashToken(token) : null,
			parsed.data.role,
			user.id
		]);
		return reply.code(201).send({
			id: result.rows[0].id,
			inviteUrl: token ? `${config.WEB_ORIGIN}/?invite=${token}` : null
		});
	});

	app.post('/api/admin/approvals', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		if (user.siteRole !== 'admin') {
			return reply.code(403).send({ error: 'Site administrator access required' });
		}
		const parsed = z.object({ email: z.string().email() }).safeParse(request.body);
		if (!parsed.success) {
			return reply.code(400).send({ error: parsed.error.flatten() });
		}
		const result = await database.query<{ id: string }>(`
			insert into invitation (email, role, created_by)
			values ($1, 'player', $2)
			returning id
		`, [ parsed.data.email, user.id ]);
		return reply.code(201).send({ id: result.rows[0].id });
	});
};
