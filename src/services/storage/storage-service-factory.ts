import { ConnectionSettings } from '@/models/connection-settings';
import { StorageService } from '@/services/storage/storage-service';
import { StravSteelService } from '@/services/storage/stravsteel-service';

export class StorageServiceFactory {
	static fromConnectionSettings = (settings: ConnectionSettings): StorageService => {
		void settings;
		return new StravSteelService();
	};
};
