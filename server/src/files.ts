import multipart from '@fastify/multipart';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { AppConfig } from './config.js';
import { DatabasePool } from './db.js';
import { canEditCharacter, requireCampaign } from './storage.js';
import { requireUser } from './auth.js';

const PORTRAIT_TYPES = new Set([ 'image/jpeg', 'image/png', 'image/webp', 'image/gif' ]);
const MAX_PORTRAIT_BYTES = 5 * 1024 * 1024;
const MAX_HANDOUT_BYTES = 25 * 1024 * 1024;

const assetResponse = (asset: {
	id: string;
	original_name: string;
	content_type: string;
	byte_size: string;
	created_at: Date;
}) => ({
	id: asset.id,
	name: asset.original_name,
	contentType: asset.content_type,
	byteSize: Number(asset.byte_size),
	createdAt: asset.created_at,
	url: `/api/files/${asset.id}`
});

export const registerFiles = async (
	app: FastifyInstance,
	config: AppConfig,
	database: DatabasePool
) => {
	await mkdir(config.UPLOAD_DIRECTORY, { recursive: true });
	await app.register(multipart, {
		limits: {
			files: 1,
			fileSize: MAX_HANDOUT_BYTES
		}
	});

	app.post('/api/files/portraits/:heroId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		if (!await canEditCharacter(database, access, heroId)) {
			return reply.code(403).send({ error: 'You cannot change this character portrait' });
		}
		const upload = await request.file({
			limits: { fileSize: MAX_PORTRAIT_BYTES }
		});
		if (!upload || !PORTRAIT_TYPES.has(upload.mimetype)) {
			return reply.code(400).send({ error: 'Portraits must be PNG, JPEG, WebP, or GIF images' });
		}

		const storageKey = randomUUID();
		const target = resolve(config.UPLOAD_DIRECTORY, storageKey);
		await pipeline(upload.file, createWriteStream(target, { flags: 'wx' }));
		if (upload.file.truncated) {
			await rm(target, { force: true });
			return reply.code(413).send({ error: 'Portraits must be 5 MB or smaller' });
		}

		const oldAsset = await database.query<{ storage_key: string }>(`
			select storage_key from file_asset
			where campaign_id = $1 and character_id = $2 and asset_type = 'portrait'
		`, [ access.campaignId, heroId ]);
		try {
			const result = await database.query<{
				id: string;
				original_name: string;
				content_type: string;
				byte_size: string;
				created_at: Date;
			}>(`
				insert into file_asset (
					campaign_id, character_id, uploaded_by, asset_type,
					storage_key, content_type, original_name, byte_size
				)
				values ($1, $2, $3, 'portrait', $4, $5, $6, $7)
				on conflict (character_id) where asset_type = 'portrait' do update
				set uploaded_by = excluded.uploaded_by,
					storage_key = excluded.storage_key,
					content_type = excluded.content_type,
					original_name = excluded.original_name,
					byte_size = excluded.byte_size,
					created_at = now()
				returning id, original_name, content_type, byte_size, created_at
			`, [
				access.campaignId,
				heroId,
				access.user.id,
				storageKey,
				upload.mimetype,
				basename(upload.filename),
				upload.file.bytesRead
			]);
			if (oldAsset.rows[0]) {
				await rm(resolve(config.UPLOAD_DIRECTORY, oldAsset.rows[0].storage_key), { force: true });
			}
			return reply.code(201).send(assetResponse(result.rows[0]));
		} catch (error) {
			await rm(target, { force: true });
			throw error;
		}
	});

	app.get('/api/files/portraits/:heroId', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const { heroId } = request.params as { heroId: string };
		const result = await database.query(`
			select id, original_name, content_type, byte_size, created_at
			from file_asset
			where campaign_id = $1 and character_id = $2 and asset_type = 'portrait'
		`, [ access.campaignId, heroId ]);
		return result.rows[0] ? assetResponse(result.rows[0]) : null;
	});

	app.post('/api/files/handouts', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		if (access.role !== 'director') {
			return reply.code(403).send({ error: 'Director access required' });
		}
		const upload = await request.file();
		if (!upload) {
			return reply.code(400).send({ error: 'Choose a handout to upload' });
		}
		const storageKey = randomUUID();
		const target = resolve(config.UPLOAD_DIRECTORY, storageKey);
		await pipeline(upload.file, createWriteStream(target, { flags: 'wx' }));
		if (upload.file.truncated) {
			await rm(target, { force: true });
			return reply.code(413).send({ error: 'Handouts must be 25 MB or smaller' });
		}
		try {
			const result = await database.query<{
				id: string;
				original_name: string;
				content_type: string;
				byte_size: string;
				created_at: Date;
			}>(`
				insert into file_asset (
					campaign_id, uploaded_by, asset_type, storage_key,
					content_type, original_name, byte_size
				)
				values ($1, $2, 'handout', $3, $4, $5, $6)
				returning id, original_name, content_type, byte_size, created_at
			`, [
				access.campaignId,
				access.user.id,
				storageKey,
				upload.mimetype || 'application/octet-stream',
				basename(upload.filename),
				upload.file.bytesRead
			]);
			return reply.code(201).send(assetResponse(result.rows[0]));
		} catch (error) {
			await rm(target, { force: true });
			throw error;
		}
	});

	app.get('/api/files/handouts', async (request, reply) => {
		const access = await requireCampaign(request, reply, database);
		if (!access) {
			return;
		}
		const result = await database.query(`
			select id, original_name, content_type, byte_size, created_at
			from file_asset
			where campaign_id = $1 and asset_type = 'handout'
			order by created_at desc
		`, [ access.campaignId ]);
		return result.rows.map(assetResponse);
	});

	app.get('/api/files/:assetId', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { assetId } = request.params as { assetId: string };
		const result = await database.query<{
			storage_key: string;
			content_type: string;
			original_name: string;
			asset_type: 'portrait' | 'handout';
		}>(`
			select fa.storage_key, fa.content_type, fa.original_name, fa.asset_type
			from file_asset fa
			join campaign_member cm on cm.campaign_id = fa.campaign_id
			where fa.id = $1 and cm.user_id = $2
		`, [ assetId, user.id ]);
		const asset = result.rows[0];
		if (!asset) {
			return reply.code(404).send({ error: 'File not found' });
		}
		reply.type(asset.content_type);
		reply.header(
			'content-disposition',
			`${asset.asset_type === 'portrait' ? 'inline' : 'attachment'}; filename="${basename(asset.original_name).replaceAll('"', '')}"`
		);
		return reply.send(createReadStream(resolve(config.UPLOAD_DIRECTORY, asset.storage_key)));
	});

	app.delete('/api/files/:assetId', async (request, reply) => {
		const user = await requireUser(request, reply, database);
		if (!user) {
			return;
		}
		const { assetId } = request.params as { assetId: string };
		const result = await database.query<{ storage_key: string }>(`
			delete from file_asset fa
			using campaign_member cm
			where fa.id = $1
				and cm.campaign_id = fa.campaign_id
				and cm.user_id = $2
				and (cm.role = 'director' or fa.uploaded_by = $2)
			returning fa.storage_key
		`, [ assetId, user.id ]);
		if (!result.rows[0]) {
			return reply.code(404).send({ error: 'File not found or cannot be deleted' });
		}
		await rm(resolve(config.UPLOAD_DIRECTORY, result.rows[0].storage_key), { force: true });
		return reply.code(204).send();
	});
};
