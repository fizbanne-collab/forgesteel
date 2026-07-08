import { BookOutlined, DatabaseFilled, DownOutlined, HomeOutlined, InfoCircleOutlined, PlayCircleOutlined, ReadOutlined, SettingOutlined, TeamOutlined, UserOutlined, WarningFilled } from '@ant-design/icons';
import { Button, Divider, Drawer, Flex, Popover, Space, Tag } from 'antd';
import { ButtonConfig, ButtonGroup } from '@/components/controls/button-group/button-group';
import { useDataManager, useOptions } from '@/contexts/data-context';
import { useEffect, useState } from 'react';
import { ConnectionSettings } from '@/models/connection-settings';
import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { Modal } from '@/components/modals/modal/modal';
import { Options } from '@/models/options';
import { SyncStatus } from '@/components/panels/sync-status/sync-status';
import { createPortal } from 'react-dom';
import { useIsSmall } from '@/hooks/use-is-small';
import { useNavigation } from '@/hooks/use-navigation';

import './app-footer.scss';

export interface FooterParams {
	accountName: string;
	errorsExist: boolean;
	showReference: () => void;
	showAbout: () => void;
	showSettings: () => void;
	showErrors: () => void;
	connectionSettings: ConnectionSettings;
}

interface Props {
	page: 'welcome' | 'heroes' | 'library' | 'session' | 'player-view' | 'clocktower';
	params: FooterParams;
}

export const AppFooter = (props: Props) => {
	const isSmall = useIsSmall();
	const navigation = useNavigation();
	const [ showSidebar, setShowSidebar ] = useState<boolean>(false);
	const [ headerLeft, setHeaderLeft ] = useState<Element | null>(null);
	const [ headerRight, setHeaderRight ] = useState<Element | null>(null);
	const options = useOptions();
	const dataManager = useDataManager();
	const saveOptions = (options: Options) => {
		dataManager.saveOptions(options);
	};

	const onOK = () => {
		saveOptions({ ...options, cookieConsent: true });
		setShowSidebar(false);
	};

	const onCancel = () => {
		window.location.assign('https://www.google.com');
	};

	useEffect(() => {
		setHeaderLeft(document.querySelector('.app-header .navigation-section'));
		setHeaderRight(document.querySelector('.app-header .global-actions-section'));
	}, []);

	const actions: ButtonConfig[] = [];
	if (props.params.errorsExist) {
		actions.push({ type: 'button', icon: <WarningFilled className='danger' />, tooltip: 'Errors', onClick: props.params.showErrors });
	}

	const navigationButtons = props.page === 'player-view' ?
		null
		: (
			<Flex className='navigation-buttons-panel' align='center' gap={2}>
				<Button type='text' className={props.page === 'welcome' ? 'selected' : ''} icon={<HomeOutlined />} title='Home' aria-label='Home' onClick={() => navigation.goToWelcome()} />
				<Divider orientation='vertical' />
				<Popover
					trigger='click'
					content={
						<Space orientation='vertical' className='app-menu-popover'>
							<Button block={true} type='text' icon={<TeamOutlined />} onClick={() => navigation.goToHeroList()}>My Heroes</Button>
							<Button
								block={true}
								type='text'
								icon={<PlayCircleOutlined />}
								onClick={() => window.dispatchEvent(new Event('stravsteel:my-campaigns'))}
							>
								My Campaigns
							</Button>
						</Space>
					}
				>
					<Button
						type='text'
						className={props.page === 'heroes' ? 'selected' : ''}
						icon={<PlayCircleOutlined />}
					>
						Play Drawsteel <DownOutlined />
					</Button>
				</Popover>
				<Divider orientation='vertical' />
				<Popover
					trigger='click'
					content={
						<Space orientation='vertical' className='app-menu-popover'>
							<Button block={true} type='text' icon={<BookOutlined />} onClick={() => navigation.goToLibrary('ancestry')}>Library</Button>
							<Button block={true} type='text' icon={<PlayCircleOutlined />} onClick={() => navigation.goToSession()}>Sessions</Button>
							<Button block={true} type='text' onClick={() => navigation.goToLibrary('encounter')}>Encounters</Button>
							<Button block={true} type='text' onClick={() => navigation.goToLibrary('montage')}>Montage</Button>
							<Button block={true} type='text' onClick={() => navigation.goToLibrary('negotiation')}>Negotiations</Button>
							<Button block={true} type='text' onClick={() => navigation.goToLibrary('tactical-map')}>Maps</Button>
						</Space>
					}
				>
					<Button
						type='text'
						className={props.page === 'library' || props.page === 'session' ? 'selected' : ''}
						icon={<BookOutlined />}
					>
						Direct Drawsteel <DownOutlined />
					</Button>
				</Popover>
			</Flex>
		);

	const moreMenu = (
		<Space orientation='vertical' className='app-menu-popover'>
			<Button block={true} type='text' icon={<SettingOutlined />} onClick={props.params.showSettings}>Settings</Button>
			<Button block={true} type='text' icon={<ReadOutlined />} onClick={props.params.showReference}>Reference</Button>
			<Button block={true} type='text' icon={<InfoCircleOutlined />} onClick={props.params.showAbout}>About</Button>
			<Divider size='small' />
			<Button block={true} type='text' onClick={() => navigation.goToExport()}>Export Data</Button>
			<Button block={true} type='text' onClick={() => navigation.goToClocktower()}>Clocktower</Button>
		</Space>
	);

	const utilityButtons = (
		<Space className='app-footer-actions'>
			<SyncStatus />
			{
				options.showDataSource && props.params.connectionSettings.dataSource && !isSmall ?
					<Tag
						icon={<DatabaseFilled />}
						variant='outlined'
						color='blue'
					>
						{props.params.connectionSettings.dataSource}
					</Tag>
					: null
			}
			<ButtonGroup buttons={actions} />
			<ButtonGroup
				buttons={[
					{
						type: 'dropdown',
						label: props.params.accountName,
						icon: <UserOutlined />,
						tooltip: props.params.accountName,
						popover: moreMenu
					}
				]}
			/>
		</Space>
	);

	const bar = (
		<div className='app-footer bottom'>
			{navigationButtons ?? <div />}
			{
				!options.cookieConsent ?
					<ButtonGroup
						buttons={[
							{ type: 'button', label: 'Cookies', onClick: () => setShowSidebar(true) }
						]}
					/>
					: null
			}
			{utilityButtons}
		</div>
	);

	return (
		<ErrorBoundary>
			{options.navigationBarAtBottom ? bar : null}
			{!options.navigationBarAtBottom && headerLeft ? createPortal(navigationButtons, headerLeft) : null}
			{!options.navigationBarAtBottom && headerRight ? createPortal(utilityButtons, headerRight) : null}
			<Drawer open={showSidebar} onClose={() => setShowSidebar(false)} closeIcon={null} size={500}>
				<Modal
					content={
						showSidebar ?
							<Space orientation='vertical' style={{ width: '100%', padding: '20px' }}>
								<div className='ds-text'>
									Just so you know, <b>FORGE STEEL</b> uses cookies. We good?
								</div>
								<Button type='primary' block={true} onClick={onOK}>
									Yes, obviously that's completely fine
								</Button>
								<Button block={true} onClick={onCancel}>
									I'm not OK with that, I had a bad experience with cookies as a child
								</Button>
							</Space>
							: null
					}
					onClose={() => setShowSidebar(false)}
				/>
			</Drawer>
		</ErrorBoundary>
	);
};
