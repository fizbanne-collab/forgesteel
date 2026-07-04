import { Alert, Avatar, Button, Card, Form, Input, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import './app-gate.scss';

export interface UserSession {
	id: string;
	email: string;
	displayName: string;
	username: string | null;
	personalCampaignId: string;
	avatarUrl: string | null;
	siteRole: 'admin' | 'player';
}

interface Campaign {
	id: string;
	name: string;
	description: string;
	isPersonal: boolean;
	role: 'director' | 'player';
}

interface Props {
	onReady: (session: UserSession) => void;
}

type GateState = 'loading' | 'signed-out' | 'profile' | 'campaigns' | 'error';

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
		const body = await response.json().catch(() => null) as { error?: string } | null;
		throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
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

	const loadCampaigns = async (currentSession: UserSession) => {
		const available = await request<Campaign[]>('/api/campaigns');
		setCampaigns(available);
		const previous = localStorage.getItem('stravsteel-active-campaign');
		const campaignID = available.some(campaign => campaign.id === previous)
			? previous!
			: currentSession.personalCampaignId;
		localStorage.setItem('stravsteel-active-campaign', campaignID);
		setSelectedCampaign(campaignID);
		onReady(currentSession);
	};

	useEffect(() => {
		request<UserSession>('/api/auth/session')
			.then(async currentSession => {
				setSession(currentSession);
				if (invite) {
					await request(`/api/invitations/${encodeURIComponent(invite)}/accept`, { method: 'POST' });
					history.replaceState({}, '', location.pathname);
				}
				if (currentSession.username) {
					await loadCampaigns(currentSession);
				} else {
					setState('profile');
				}
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

	const saveUsername = async ({ username }: { username: string }) => {
		try {
			const profile = await request<{ username: string }>('/api/auth/profile', {
				method: 'PATCH',
				body: JSON.stringify({ username })
			});
			const updatedSession = session ? { ...session, username: profile.username } : null;
			setSession(updatedSession);
			setError(undefined);
			if (updatedSession) {
				await loadCampaigns(updatedSession);
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Unable to save username.');
		}
	};

	const createCampaign = async ({ name, description }: { name: string; description?: string }) => {
		try {
			const campaign = await request<Campaign>('/api/campaigns', {
				method: 'POST',
				body: JSON.stringify({ name, description })
			});
			setCampaigns(current => [ ...current, campaign ]);
			setSelectedCampaign(campaign.id);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Unable to create campaign.');
		}
	};

	const enter = () => {
		if (!selectedCampaign || !session) {
			return;
		}
		localStorage.setItem('stravsteel-active-campaign', selectedCampaign);
		onReady(session);
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

	if (state === 'profile') {
		return (
			<div className='app-gate'>
				<Card className='app-gate-card'>
					<Space orientation='vertical' size='large' style={{ width: '100%' }}>
						<Typography.Title level={2}>Choose your username</Typography.Title>
						<Typography.Paragraph>
							Your username is how other players can invite you to campaigns.
						</Typography.Paragraph>
						<Form layout='vertical' onFinish={saveUsername}>
							<Form.Item
								name='username'
								label='Username'
								rules={[
									{ required: true },
									{ pattern: /^[A-Za-z0-9_]{3,24}$/, message: 'Use 3-24 letters, numbers, or underscores.' }
								]}
							>
								<Input autoFocus placeholder='Username' />
							</Form.Item>
							<Button type='primary' htmlType='submit'>Continue</Button>
						</Form>
						{error ? <Alert type='error' showIcon title={error} /> : null}
					</Space>
				</Card>
			</div>
		);
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
						<Form.Item name='description' label='Description (optional)' rules={[ { max: 1000 } ]}>
							<Input.TextArea placeholder='What is this campaign about?' rows={3} />
						</Form.Item>
						<Button htmlType='submit'>Create campaign</Button>
					</Form>
					{error ? <Alert type='error' showIcon title={error} /> : null}
				</Space>
			</Card>
		</div>
	);
};
