export type FSDataSource = 'Local' | 'StravSteel' | 'Warehouse' | undefined;

export interface ConnectionSettings {
	useManualWarehouse: boolean;
	warehouseHost: string;
	warehouseToken: string;
	dataSource: FSDataSource;
}
