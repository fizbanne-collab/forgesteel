import jsonPatch, { type Operation } from 'fast-json-patch';
import { Hero } from '@/models/hero';
import { Session } from '@/models/session';
import { Sourcebook } from '@/models/sourcebook';
import { StorageService } from '@/services/storage/storage-service';
import localforage from 'localforage';

const { compare } = jsonPatch;
const HIDDEN_SOURCEBOOK_IDS_KEY = 'stravsteel-hidden-sourcebook-ids';

interface PresenceViewer {
	id: string;
	displayName: string;
	avatarUrl: string | null;
}

export class StravSteelService implements StorageService {
	private campaignID = '';
	private userID = '';
	private viewingCharacterID: string | null = null;
	private readonly heroRevisions = new Map<string, number>();
	private readonly heroSnapshots = new Map<string, Hero>();
	private realtimeSocket?: WebSocket;

	async initialize(): Promise<boolean> {
		this.campaignID = localStorage.getItem('stravsteel-active-campaign') ?? '';
		if (!this.campaignID) {
			throw new Error('Choose an active campaign before loading StravSteel data.');
		}
		const session = await this.request<{ id: string }>('/api/auth/session');
		this.userID = session.id;
		window.addEventListener('stravsteel:presence-viewing', event => {
			this.viewingCharacterID = (event as CustomEvent<string | null>).detail;
			this.sendPresence();
		});
		this.connectRealtime();
		return true;
	}

	private connectRealtime() {
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = new URL('/api/realtime', `${protocol}//${location.host}`);
		url.searchParams.set('campaignId', this.campaignID);
		this.realtimeSocket = new WebSocket(url);
		this.realtimeSocket.addEventListener('message', event => {
			const message = JSON.parse(event.data as string) as {
				type: string;
				characterId?: string;
				document?: Hero;
				revision?: number;
				characters?: Record<string, PresenceViewer[]>;
			};
			if (message.type === 'connected') {
				this.sendPresence();
			}
			if (
				message.type === 'character.updated'
				&& message.characterId
				&& message.document
				&& message.revision
			) {
				this.heroRevisions.set(message.characterId, message.revision);
				this.heroSnapshots.set(message.characterId, structuredClone(message.document));
				window.dispatchEvent(new CustomEvent('stravsteel:hero-updated', {
					detail: message.document
				}));
			}
			if (message.type === 'presence.updated' && message.characters) {
				const characters = Object.fromEntries(
					Object.entries(message.characters).map(([ characterId, viewers ]) => [
						characterId,
						viewers.filter(viewer => viewer.id !== this.userID)
					])
				);
				window.dispatchEvent(new CustomEvent('stravsteel:presence-updated', {
					detail: characters
				}));
			}
		});
		this.realtimeSocket.addEventListener('close', () => {
			window.setTimeout(() => this.connectRealtime(), 2000);
		});
	}

	private sendPresence() {
		if (this.realtimeSocket?.readyState === WebSocket.OPEN) {
			this.realtimeSocket.send(JSON.stringify({
				type: 'presence.viewing',
				characterId: this.viewingCharacterID
			}));
		}
	}

	private async request<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			credentials: 'include',
			...init,
			headers: {
				...(init?.body ? { 'content-type': 'application/json' } : {}),
				'x-stravsteel-campaign-id': this.campaignID,
				...init?.headers
			}
		});
		if (!response.ok) {
			const body = await response.json().catch(() => null) as { error?: string } | null;
			throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
		}
		return response.status === 204 ? undefined as T : response.json() as Promise<T>;
	}

	getHeroes(): Promise<Hero[]> {
		return this.request<Hero[]>('/api/storage/heroes');
	}

	getHero(id: string): Promise<Hero | null> {
		return this.request<{ document: Hero; revision: number }>(`/api/storage/heroes/${encodeURIComponent(id)}`)
			.then(result => {
				this.heroRevisions.set(id, result.revision);
				this.heroSnapshots.set(id, structuredClone(result.document));
				return result.document;
			})
			.catch(error => {
				if (error instanceof Error && error.message === 'Character not found') {
					return null;
				}
				throw error;
			});
	}

	async putHero(hero: Hero): Promise<Hero> {
		const previous = this.heroSnapshots.get(hero.id);
		const operations: Operation[] = previous ? compare(previous, hero) : [];
		if (previous && operations.length === 0) {
			return hero;
		}
		const response = await fetch(`/api/storage/heroes/${encodeURIComponent(hero.id)}`, {
			credentials: 'include',
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				'x-stravsteel-campaign-id': this.campaignID
			},
			body: JSON.stringify({
				baseRevision: this.heroRevisions.get(hero.id) ?? 0,
				document: previous ? undefined : hero,
				operations
			})
		});
		const result = await response.json() as {
			error?: string;
			document?: Hero;
			revision?: number;
		};
		if (!response.ok || !result.document || !result.revision) {
			if (result.document && result.revision) {
				this.heroSnapshots.set(hero.id, structuredClone(result.document));
				this.heroRevisions.set(hero.id, result.revision);
				window.dispatchEvent(new CustomEvent('stravsteel:hero-updated', {
					detail: result.document
				}));
			}
			throw new Error(result.error ?? `${response.status} ${response.statusText}`);
		}
		this.heroSnapshots.set(hero.id, structuredClone(result.document));
		this.heroRevisions.set(hero.id, result.revision);
		return result.document;
	}

	deleteHero(id: string): Promise<void> {
		return this.request<void>(`/api/storage/heroes/${encodeURIComponent(id)}`, {
			method: 'DELETE'
		}).then(() => {
			this.heroSnapshots.delete(id);
			this.heroRevisions.delete(id);
		});
	}

	getSourcebooks(): Promise<Sourcebook[]> {
		return this.request<Sourcebook[]>('/api/storage/sourcebooks');
	}

	getSourcebook(id: string): Promise<Sourcebook | null> {
		return this.request<Sourcebook>(`/api/storage/sourcebooks/${encodeURIComponent(id)}`)
			.catch(error => {
				if (error instanceof Error && error.message === 'Sourcebook not found') {
					return null;
				}
				throw error;
			});
	}

	putSourcebook(sourcebook: Sourcebook): Promise<Sourcebook> {
		return this.request<Sourcebook>(`/api/storage/sourcebooks/${encodeURIComponent(sourcebook.id)}`, {
			method: 'PUT',
			body: JSON.stringify(sourcebook)
		});
	}

	deleteSourcebook(id: string): Promise<void> {
		return this.request<void>(`/api/storage/sourcebooks/${encodeURIComponent(id)}`, {
			method: 'DELETE'
		});
	}

	getSession(): Promise<Session | null> {
		return this.request<Session | null>('/api/storage/session');
	}

	putSession(session: Session): Promise<Session> {
		return this.request<Session>('/api/storage/session', {
			method: 'PUT',
			body: JSON.stringify(session)
		});
	}

	getHiddenSourcebookIDs(): Promise<string[] | null> {
		return localforage.getItem<string[]>(HIDDEN_SOURCEBOOK_IDS_KEY);
	}

	putHiddenSourcebookIDs(ids: string[]): Promise<string[]> {
		return localforage.setItem<string[]>(HIDDEN_SOURCEBOOK_IDS_KEY, ids);
	}
}
