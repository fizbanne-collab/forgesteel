import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jsonPatch from 'fast-json-patch';
import { z } from 'zod';
import type { Operation } from 'fast-json-patch';
import { AuthenticatedUser, requireUser } from './auth.js';
import { DatabasePool } from './db.js';
import { RealtimeHub } from './realtime.js';

const { applyPatch } = jsonPatch;

type CampaignRole = 'director' | 'player';

export interface CampaignAccess {
	user: AuthenticatedUser;
	campaignId: string;
	role: CampaignRole;
}

const documentSchema = z.record(z.string(), z.unknown());
const operationSchema = z.object({
	op: z.enum([ 'add', 'remove', 'replace', 'move', 'copy', 'test' ]),
	path: z.string(),
	from: z.string().optional(),
	value: z.unknown().optional()
});
const characterUpdateSchema = z.object({
	baseRevision: z.number().int().min(0),
	document: documentSchema.optional(),
	operations: z.array(operationSchema).default([])
});

const pathsOverlap = (left: string, right: string) => {
	return left === right
		|| left.startsWith(`${right}/`)
		|| right.startsWith(`${left}/`);
};

const hasConflicts = (incoming: Operation[], accepted: Operation[]) => {
	return incoming.some(operation => accepted.some(previous => {
		return pathsOverlap(operation.path, previous.path)
			|| Boolean('from' in operation && pathsOverlap(operation.from, previous.path))
			|| Boolean('from' in previous && pathsOverlap(operation.path, previous.from));
	}));
};

export const requireCampaign = async (
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

export const canEditCharacter = async (
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

export const registerStorage = (
	app: FastifyInstance,
	database: DatabasePool,
	realtime: RealtimeHub
) => {
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
		const result = await database.query<{ document: unknown; revision: string }>(`
			select document, revision from character where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId ]);
		const character = result.rows[0];
		return character
			? { document: character.document, revision: Number(character.revision) }
			: reply.code(404).send({ error: 'Character not found' });
	});

	app.put('/api/storage/heroes/:heroId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		const parsed = characterUpdateSchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.code(400).send({ error: parsed.error.flatten() });
		}

		const client = await database.connect();
		let savedDocument: Record<string, unknown>;
		let savedRevision: number;
		try {
			await client.query('begin');
			const existing = await client.query<{
				owner_id: string | null;
				document: Record<string, unknown>;
				revision: string;
			}>(`
				select owner_id, document, revision
				from character
				where id = $1 and campaign_id = $2
				for update
			`, [ heroId, access.campaignId ]);
			const current = existing.rows[0];

			if (!current) {
				if (parsed.data.baseRevision !== 0 || !parsed.data.document || parsed.data.document.id !== heroId) {
					await client.query('rollback');
					return reply.code(409).send({ error: 'A new character requires a complete document at revision 0' });
				}
				savedDocument = parsed.data.document;
				savedRevision = 1;
				await client.query(`
					insert into character (
						id, campaign_id, owner_id, document, revision, created_by
					)
					values ($1, $2, $3, $4, 1, $3)
				`, [ heroId, access.campaignId, access.user.id, savedDocument ]);
			} else {
				if (access.role !== 'director' && current.owner_id !== access.user.id) {
					await client.query('rollback');
					return reply.code(403).send({ error: 'You cannot edit this character' });
				}
				const currentRevision = Number(current.revision);
				if (parsed.data.baseRevision > currentRevision) {
					await client.query('rollback');
					return reply.code(409).send({
						error: 'Character revision is ahead of the server',
						document: current.document,
						revision: currentRevision
					});
				}
				if (parsed.data.baseRevision < currentRevision) {
					const recentChanges = await client.query<{ patch: Operation[] }>(`
						select patch from character_change
						where character_id = $1 and revision > $2
						order by revision
					`, [ heroId, parsed.data.baseRevision ]);
					const acceptedOperations = recentChanges.rows.flatMap(change => {
						return Array.isArray(change.patch) ? change.patch : [];
					});
					if (hasConflicts(parsed.data.operations as Operation[], acceptedOperations)) {
						await client.query('rollback');
						return reply.code(409).send({
							error: 'Character fields changed in another session',
							document: current.document,
							revision: currentRevision
						});
					}
				}

				savedDocument = applyPatch(
					structuredClone(current.document),
					parsed.data.operations as Operation[],
					true,
					false
				).newDocument as Record<string, unknown>;
				if (savedDocument.id !== heroId) {
					await client.query('rollback');
					return reply.code(400).send({ error: 'Character ID cannot be changed' });
				}
				savedRevision = currentRevision + 1;
				await client.query(`
					update character
					set document = $3, revision = $4, updated_at = now()
					where id = $1 and campaign_id = $2
				`, [ heroId, access.campaignId, savedDocument, savedRevision ]);
			}

			await client.query(`
				insert into character_change (
					character_id, revision, changed_by, patch, snapshot
				)
				values ($1, $2, $3, $4, $5)
			`, [
				heroId,
				savedRevision,
				access.user.id,
				JSON.stringify(parsed.data.operations),
				savedDocument
			]);
			await client.query('commit');
		} catch (error) {
			await client.query('rollback');
			throw error;
		} finally {
			client.release();
		}
		realtime.broadcast({
			type: 'character.updated',
			campaignId: access.campaignId,
			characterId: heroId,
			document: savedDocument,
			revision: savedRevision,
			changedBy: access.user.id
		});
		return { document: savedDocument, revision: savedRevision };
	});

	app.get('/api/storage/heroes/:heroId/history', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		const character = await database.query(`
			select 1 from character where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId ]);
		if (!character.rowCount) {
			return reply.code(404).send({ error: 'Character not found' });
		}
		const result = await database.query(`
			select
				cc.revision,
				cc.patch,
				cc.created_at as "changedAt",
				u.id as "changedById",
				u.display_name as "changedByName"
			from character_change cc
			join app_user u on u.id = cc.changed_by
			where cc.character_id = $1
			order by cc.revision desc
			limit 5
		`, [ heroId ]);
		return result.rows;
	});

	app.post('/api/storage/heroes/:heroId/history/:revision/restore', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId, revision } = request.params as { heroId: string; revision: string };
		if (!await canEditCharacter(database, access, heroId)) {
			return reply.code(403).send({ error: 'You cannot restore this character' });
		}
		const snapshot = await database.query<{ snapshot: Record<string, unknown> }>(`
			select snapshot from character_change where character_id = $1 and revision = $2
		`, [ heroId, Number(revision) ]);
		if (!snapshot.rows[0]) {
			return reply.code(404).send({ error: 'Character history entry not found' });
		}
		const current = await database.query<{ document: Record<string, unknown>; revision: string }>(`
			select document, revision from character where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId ]);
		const nextRevision = Number(current.rows[0].revision) + 1;
		await database.query(`
			update character set document = $3, revision = $4, updated_at = now()
			where id = $1 and campaign_id = $2
		`, [ heroId, access.campaignId, snapshot.rows[0].snapshot, nextRevision ]);
		await database.query(`
			insert into character_change (character_id, revision, changed_by, patch, snapshot)
			values ($1, $2, $3, $4, $5)
		`, [
			heroId,
			nextRevision,
			access.user.id,
			JSON.stringify([ { op: 'replace', path: '', value: snapshot.rows[0].snapshot } ]),
			snapshot.rows[0].snapshot
		]);
		realtime.broadcast({
			type: 'character.updated',
			campaignId: access.campaignId,
			characterId: heroId,
			document: snapshot.rows[0].snapshot,
			revision: nextRevision,
			changedBy: access.user.id
		});
		return { document: snapshot.rows[0].snapshot, revision: nextRevision };
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
