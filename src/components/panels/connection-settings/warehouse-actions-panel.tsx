import { Button, Divider } from 'antd';
import { ConnectionSettings } from '@/models/connection-settings';
import { useNavigate } from 'react-router';

interface Props {
	connectionSettings: ConnectionSettings;
}

export const WarehouseActionsPanel = (props: Props) => {
	const navigate = useNavigate();
	const showTransferButton = props.connectionSettings.useManualWarehouse;

	const goToTransferPage = () => {
		navigate('/transfer');
	};

	return (
		<>
			{
				showTransferButton ?
					<Button
						block={true}
						type='primary'
						onClick={goToTransferPage}
					>
						Transfer Data
					</Button>
					: null
			}
			{
				showTransferButton ?
					<Divider size='small' />
					: null
			}
		</>
	);
};
