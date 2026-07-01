import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthenticatedUser, requireUser } from './auth.js';
import { DatabasePool } from './db.js';

type CampaignRole = 'director' | 'player';

interface CampaignAccess {
	user: AuthenticatedUser;
	campaignId: string;
	role: CampaignRole;
}

const documentSchema = z.record(z.string(), z.unknown());

const requireCampaign = async (
	request: FastifyRequest,
	reply: FastifyReply,
	database: DatabasePool
): Promise<CampaignAccess | null> => {
	const user = await requireUser(request, reply, database);
	if (!user) {
		return null;
	}
	const campaignId = request.headers['x-stravsteel-campaign-id'];
	if (typeof campaignId !== 'string') {
		await reply.code(400).send({ error: 'An active campaign is required' });
		return null;
	}
	const membership = await database.query<{ role: CampaignRole }>(`
		select role from campaign_member
		where campaign_id = $1 and user_id = $2
	`, [ campaignId, user.id ]);
	const role = membership.rows[0]?.role;
	if (!role) {
		await reply.code(403).send({ error: 'Campaign access required' });
		return null;
	}
	return { user, campaignId, role };
};

const canEditCharacter = async (
	database: DatabasePool,
	access: CampaignAccess,
	characterId: string
) => {
	if (access.role === 'director') {
		return true;
	}
	const result = await database.query(`
		select 1 from character
		where id = $1 and campaign_id = $2 and owner_id = $3
	`, [ characterId, access.campaignId, access.user.id ]);
	return Boolean(result.rowCount);
};

export const registerStorage = (app: FastifyInstance, database: DatabasePool) => {
	app.get('/api/storage/heroes', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const result = await database.query(`
			select jsonb_build_object(
				'id', document->>'id',
				'name', coalesce(document->>'name', ''),
				'folder', coalesce(document->>'folder', '')
			) as document
			from character
			where campaign_id = $1
			order by lower(coalesce(document->>'name', ''))
		`, [ access.campaignId ]);
		return result.rows.map(row => row.document);
	});

	app.get('/api/storage/heroes/:heroId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		const result = await database.query<{ document: unknown }>(`
			select document from character where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId ]);
		return result.rows[0]?.document ?? reply.code(404).send({ error: 'Character not found' });
	});

	app.put('/api/storage/heroes/:heroId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		const parsed = documentSchema.safeParse(request.body);
		if (!parsed.success || parsed.data.id !== heroId) {
			return reply.code(400).send({ error: 'Character document ID must match the route' });
		}

		const existing = await database.query<{ owner_id: string | null }>(`
			select owner_id from character where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId ]);
		if (existing.rowCount && !await canEditCharacter(database, access, heroId)) {
			return reply.code(403).send({ error: 'You cannot edit this character' });
		}

		const client = await database.connect();
		try {
			await client.query('begin');
			const saved = await client.query<{ revision: string }>(`
				insert into character (
					id, campaign_id, owner_id, document, revision, created_by
				)
				values ($1, $2, $3, $4, 1, $3)
				on conflict (id) do update
				set document = excluded.document,
					revision = character.revision + 1,
					updated_at = now()
				where character.campaign_id = excluded.campaign_id
				returning revision
			`, [ heroId, access.campaignId, existing.rows[0]?.owner_id ?? access.user.id, parsed.data ]);
			if (!saved.rowCount) {
				await client.query('rollback');
				return reply.code(409).send({ error: 'Character ID belongs to another campaign' });
			}
			await client.query(`
				insert into character_change (
					character_id, revision, changed_by, patch, snapshot
				)
				values ($1, $2, $3, $4, $5)
			`, [
				heroId,
				Number(saved.rows[0].revision),
				access.user.id,
				{ type: 'replace-document' },
				parsed.data
			]);
			await client.query('commit');
			return parsed.data;
		} catch (error) {
			await client.query('rollback');
			throw error;
		} finally {
			client.release();
		}
	});

	app.delete('/api/storage/heroes/:heroId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		if (!await canEditCharacter(database, access, heroId)) {
			return reply.code(403).send({ error: 'You cannot delete this character' });
		}
		const result = await database.query(`
			delete from character where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId ]);
		return result.rowCount
			? reply.code(204).send()
			: reply.code(404).send({ error: 'Character not found' });
	});

	app.get('/api/storage/sourcebooks', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const result = await database.query<{ document: unknown }>(`
			select document from campaign_document
			where campaign_id = $1 and document_type = 'sourcebook'
			order by lower(coalesce(document->>'name', ''))
		`, [ access.campaignId ]);
		return result.rows.map(row => row.document);
	});

	app.get('/api/storage/sourcebooks/:sourcebookId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { sourcebookId } = request.params as { sourcebookId: string };
		const result = await database.query<{ document: unknown }>(`
			select document from campaign_document
			where campaign_id = $1 and document_type = 'sourcebook' and document_key = $2
		`, [ access.campaignId, sourcebookId ]);
		return result.rows[0]?.document ?? reply.code(404).send({ error: 'Sourcebook not found' });
	});

	app.put('/api/storage/sourcebooks/:sourcebookId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		if (access.role !== 'director') {
			return reply.code(403).send({ error: 'Director access required' });
		}
		const { sourcebookId } = request.params as { sourcebookId: string };
		const parsed = documentSchema.safeParse(request.body);
		if (!parsed.success || parsed.data.id !== sourcebookId) {
			return reply.code(400).send({ error: 'Sourcebook document ID must match the route' });
		}
		await database.query(`
			insert into campaign_document (
				campaign_id, document_type, document_key, document, created_by
			)
			values ($1, 'sourcebook', $2, $3, $4)
			on conflict (campaign_id, document_type, document_key) do update
			set document = excluded.document,
				revision = campaign_document.revision + 1,
				updated_at = now()
		`, [ access.campaignId, sourcebookId, parsed.data, access.user.id ]);
		return parsed.data;
	});

	app.delete('/api/storage/sourcebooks/:sourcebookId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		if (access.role !== 'director') {
			return reply.code(403).send({ error: 'Director access required' });
		}
		const { sourcebookId } = request.params as { sourcebookId: string };
		const result = await database.query(`
			delete from campaign_document
			where campaign_id = $1 and document_type = 'sourcebook' and document_key = $2
		`, [ access.campaignId, sourcebookId ]);
		return result.rowCount
			? reply.code(204).send()
			: reply.code(404).send({ error: 'Sourcebook not found' });
	});

	app.get('/api/storage/session', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const result = await database.query<{ document: unknown }>(`
			select document from campaign_document
			where campaign_id = $1 and document_type = 'session' and document_key = 'current'
		`, [ access.campaignId ]);
		return result.rows[0]?.document ?? null;
	});

	app.put('/api/storage/session', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const parsed = documentSchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.code(400).send({ error: parsed.error.flatten() });
		}
		await database.query(`
			insert into campaign_document (
				campaign_id, document_type, document_key, document, created_by
			)
			values ($1, 'session', 'current', $2, $3)
			on conflict (campaign_id, document_type, document_key) do update
			set document = excluded.document,
				revision = campaign_document.revision + 1,
				updated_at = now()
		`, [ access.campaignId, parsed.data, access.user.id ]);
		return parsed.data;
	});

	app.get('/api/storage/export', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const [ campaign, characters, documents ] = await Promise.all([
			database.query('select id, name, created_at, updated_at from campaign where id = $1', [ access.campaignId ]),
			database.query('select document from character where campaign_id = $1 order by created_at', [ access.campaignId ]),
			database.query(`
				select document_type, document_key, document
				from campaign_document where campaign_id = $1 order by document_type, document_key
			`, [ access.campaignId ])
		]);
		return {
			exportedAt: new Date().toISOString(),
			campaign: campaign.rows[0],
			characters: characters.rows.map(row => row.document),
			documents: documents.rows
		};
	});
};
