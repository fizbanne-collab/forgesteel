import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { DatabasePool } from './db.js';
import { getSessionUser } from './auth.js';

export interface CharacterUpdateMessage {
	type: 'character.updated';
	campaignId: string;
	characterId: string;
	document: Record<string, unknown>;
	revision: number;
	changedBy: string;
}

interface PresenceUser {
	id: string;
	displayName: string;
	avatarUrl: string | null;
}

interface PresenceConnection extends PresenceUser {
	socket: WebSocket;
	characterId: string | null;
}

export class RealtimeHub {
	private readonly campaignRooms = new Map<string, Set<WebSocket>>();
	private readonly presence = new Map<string, Map<WebSocket, PresenceConnection>>();

	join(campaignId: string, socket: WebSocket, user: PresenceUser) {
		const room = this.campaignRooms.get(campaignId) ?? new Set<WebSocket>();
		room.add(socket);
		this.campaignRooms.set(campaignId, room);
		const campaignPresence = this.presence.get(campaignId) ?? new Map<WebSocket, PresenceConnection>();
		campaignPresence.set(socket, { ...user, socket, characterId: null });
		this.presence.set(campaignId, campaignPresence);
		socket.on('close', () => {
			room.delete(socket);
			campaignPresence.delete(socket);
			if (room.size === 0) {
				this.campaignRooms.delete(campaignId);
				this.presence.delete(campaignId);
			} else {
				this.broadcastPresence(campaignId);
			}
		});
		this.broadcastPresence(campaignId);
	}

	setViewing(campaignId: string, socket: WebSocket, characterId: string | null) {
		const connection = this.presence.get(campaignId)?.get(socket);
		if (!connection) {
			return;
		}
		connection.characterId = characterId;
		this.broadcastPresence(campaignId);
	}

	broadcast(message: CharacterUpdateMessage) {
		const serialized = JSON.stringify(message);
		for (const socket of this.campaignRooms.get(message.campaignId) ?? []) {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(serialized);
			}
		}
	}

	private broadcastPresence(campaignId: string) {
		const characters: Record<string, PresenceUser[]> = {};
		for (const connection of this.presence.get(campaignId)?.values() ?? []) {
			if (!connection.characterId) {
				continue;
			}
			const viewers = characters[connection.characterId] ?? [];
			if (!viewers.some(viewer => viewer.id === connection.id)) {
				viewers.push({
					id: connection.id,
					displayName: connection.displayName,
					avatarUrl: connection.avatarUrl
				});
			}
			characters[connection.characterId] = viewers;
		}
		const serialized = JSON.stringify({
			type: 'presence.updated',
			campaignId,
			characters
		});
		for (const socket of this.campaignRooms.get(campaignId) ?? []) {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(serialized);
			}
		}
	}
}

export const registerRealtime = (
	app: FastifyInstance,
	database: DatabasePool,
	hub: RealtimeHub
) => {
	app.get('/api/realtime', { websocket: true }, async (socket, request) => {
		const user = await getSessionUser(request, database);
		const { campaignId } = request.query as { campaignId?: string };
		if (!user || !campaignId) {
			socket.close(1008, 'Authentication and campaign are required');
			return;
		}
		const membership = await database.query(`
			select 1 from campaign_member where campaign_id = $1 and user_id = $2
		`, [ campaignId, user.id ]);
		if (!membership.rowCount) {
			socket.close(1008, 'Campaign access required');
			return;
		}
		hub.join(campaignId, socket, {
			id: user.id,
			displayName: user.displayName,
			avatarUrl: user.avatarUrl
		});
		socket.on('message', async data => {
			let message: { type?: string; characterId?: string | null };
			try {
				message = JSON.parse(data.toString()) as typeof message;
			} catch {
				return;
			}
			if (message.type !== 'presence.viewing') {
				return;
			}
			if (message.characterId) {
				const character = await database.query(`
					select 1 from character where id = $1 and campaign_id = $2
				`, [ message.characterId, campaignId ]);
				if (!character.rowCount) {
					return;
				}
			}
			hub.setViewing(campaignId, socket, message.characterId ?? null);
		});
		socket.send(JSON.stringify({ type: 'connected', campaignId }));
	});
};
