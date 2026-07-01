import { Alert, Avatar, Button, Card, Form, Input, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import './app-gate.scss';

interface UserSession {
	id: string;
	email: string;
	displayName: string;
	avatarUrl: string | null;
	siteRole: 'admin' | 'player';
}

interface Campaign {
	id: string;
	name: string;
	role: 'director' | 'player';
}

interface Props {
	onReady: () => void;
}

type GateState = 'loading' | 'signed-out' | 'campaigns' | 'error';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		credentials: 'include',
		...init,
		headers: {
			...(init?.body ? { 'content-type': 'application/json' } : {}),
			...init?.headers
		}
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const AppGate = ({ onReady }: Props) => {
	const [ state, setState ] = useState<GateState>('loading');
	const [ session, setSession ] = useState<UserSession | null>(null);
	const [ campaigns, setCampaigns ] = useState<Campaign[]>([]);
	const [ selectedCampaign, setSelectedCampaign ] = useState<string>();
	const [ error, setError ] = useState<string>();
	const invite = new URLSearchParams(location.search).get('invite');

	const loadCampaigns = async () => {
		const available = await request<Campaign[]>('/api/campaigns');
		setCampaigns(available);
		const previous = localStorage.getItem('stravsteel-active-campaign');
		setSelectedCampaign(available.some(campaign => campaign.id === previous) ? previous ?? undefined : available[0]?.id);
		setState('campaigns');
	};

	useEffect(() => {
		request<UserSession>('/api/auth/session')
			.then(async currentSession => {
				setSession(currentSession);
				if (invite) {
					await request(`/api/invitations/${encodeURIComponent(invite)}/accept`, { method: 'POST' });
					history.replaceState({}, '', location.pathname);
				}
				await loadCampaigns();
			})
			.catch(reason => {
				if (reason instanceof Error && reason.message.startsWith('401')) {
					setState('signed-out');
				} else {
					setError(reason instanceof Error ? reason.message : 'Unable to connect to StravSteel.');
					setState('error');
				}
			});
	}, []);

	const createCampaign = async ({ name }: { name: string }) => {
		try {
			const campaign = await request<Campaign>('/api/campaigns', {
				method: 'POST',
				body: JSON.stringify({ name })
			});
			setCampaigns(current => [ ...current, campaign ]);
			setSelectedCampaign(campaign.id);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Unable to create campaign.');
		}
	};

	const enter = () => {
		if (!selectedCampaign) {
			return;
		}
		localStorage.setItem('stravsteel-active-campaign', selectedCampaign);
		onReady();
	};

	if (state === 'loading') {
		return <div className='app-gate'><Spin size='large' /></div>;
	}

	if (state === 'signed-out') {
		const status = new URLSearchParams(location.search).get('auth');
		return (
			<div className='app-gate'>
				<Card className='app-gate-card'>
					<Space orientation='vertical' size='large'>
						<Typography.Title>StravSteel</Typography.Title>
						<Typography.Paragraph>
							Sign in with an invited Google account to access your campaigns.
						</Typography.Paragraph>
						{status === 'invite-required' ? <Alert type='warning' showIcon title='This account has not been invited.' /> : null}
						{status === 'failed' ? <Alert type='error' showIcon title='Google sign-in failed. Please try again.' /> : null}
						<Button
							type='primary'
							size='large'
							href={`/api/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`}
						>
							Continue with Google
						</Button>
					</Space>
				</Card>
			</div>
		);
	}

	if (state === 'error') {
		return <div className='app-gate'><Alert type='error' showIcon title='StravSteel is unavailable' description={error} /></div>;
	}

	return (
		<div className='app-gate'>
			<Card className='app-gate-card'>
				<Space orientation='vertical' size='large'>
					<Space>
						<Avatar src={session?.avatarUrl}>{session?.displayName?.[0]}</Avatar>
						<div>
							<Typography.Text strong>{session?.displayName}</Typography.Text>
							<br />
							<Typography.Text type='secondary'>{session?.email}</Typography.Text>
						</div>
					</Space>
					<Typography.Title level={2}>Choose a campaign</Typography.Title>
					{campaigns.length > 0
						? (
							<>
								<Select
									value={selectedCampaign}
									onChange={setSelectedCampaign}
									options={campaigns.map(campaign => ({
										value: campaign.id,
										label: `${campaign.name} (${campaign.role})`
									}))}
									style={{ width: '100%' }}
								/>
								<Button type='primary' size='large' onClick={enter}>Enter StravSteel</Button>
							</>
						)
						: (
							<Alert type='info' showIcon title='Create your first campaign to continue.' />
						)}
					<Form layout='vertical' onFinish={createCampaign}>
						<Form.Item
							name='name'
							label='New campaign'
							rules={[ { required: true, max: 120 } ]}
						>
							<Input placeholder='Campaign name' />
						</Form.Item>
						<Button htmlType='submit'>Create campaign</Button>
					</Form>
					{error ? <Alert type='error' showIcon title={error} /> : null}
				</Space>
			</Card>
		</div>
	);
};
