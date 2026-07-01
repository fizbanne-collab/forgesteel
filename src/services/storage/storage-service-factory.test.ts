import { describe, expect, test } from 'vitest';
import { ConnectionSettings } from '@/models/connection-settings';
import { StorageServiceFactory } from '@/services/storage/storage-service-factory';
import { StravSteelService } from '@/services/storage/stravsteel-service';

describe('StorageServiceFactory', () => {
	describe('fromConnectionSettings', () => {
		test('returns the authenticated StravSteel storage provider', () => {
			const settings = {
				useManualWarehouse: false,
				warehouseHost: '',
				warehouseToken: '',
				dataSource: undefined
			} as ConnectionSettings;

			expect(StorageServiceFactory.fromConnectionSettings(settings)).toBeInstanceOf(StravSteelService);
		});
	});
});
