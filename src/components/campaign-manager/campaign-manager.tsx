import { Alert, Avatar, Button, Card, Divider, Form, Input, Modal, Popconfirm, Select, Space, Tag, Typography, Upload } from 'antd';
import { CopyOutlined, DeleteOutlined, DownloadOutlined, LogoutOutlined, PaperClipOutlined, PlusOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';

import './campaign-manager.scss';

interface UserSession {
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
	ownerId: string;
	isOwner: boolean;
	isPersonal: boolean;
	role: 'director' | 'player';
}

interface CampaignMember {
	id: string;
	email: string;
	username: string | null;
	displayName: string;
	avatarUrl: string | null;
	isOwner: boolean;
	role: 'director' | 'player';
}

interface InvitationValues {
	identifier?: string;
	mode: 'email' | 'link';
	role: 'director' | 'player';
}

interface CharacterSummary {
	id: string;
	name: string;
	campaignId: string;
	campaignName: string;
}

interface CampaignValues {
	name: string;
	description?: string;
}

interface Handout {
	id: string;
	name: string;
	contentType: string;
	byteSize: number;
	createdAt: string;
	url: string;
}

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

export const CampaignManager = () => {
	const [ open, setOpen ] = useState(false);
	const [ session, setSession ] = useState<UserSession>();
	const [ campaigns, setCampaigns ] = useState<Campaign[]>([]);
	const [ members, setMembers ] = useState<CampaignMember[]>([]);
	const [ characters, setCharacters ] = useState<CharacterSummary[]>([]);
	const [ selectedCharacterID, setSelectedCharacterID ] = useState<string>();
	const [ handouts, setHandouts ] = useState<Handout[]>([]);
	const [ uploadingHandout, setUploadingHandout ] = useState(false);
	const [ inviteMode, setInviteMode ] = useState<'email' | 'link'>('link');
	const [ inviteUrl, setInviteUrl ] = useState<string>();
	const [ notice, setNotice ] = useState<{ type: 'success' | 'error'; text: string }>();
	const activeCampaignID = localStorage.getItem('stravsteel-active-campaign');
	const activeCampaign = useMemo(
		() => campaigns.find(campaign => campaign.id === activeCampaignID),
		[ campaigns, activeCampaignID ]
	);
	const canManage = !activeCampaign?.isPersonal
		&& (activeCampaign?.role === 'director' || session?.siteRole === 'admin');

	const loadMembers = async () => {
		if (!activeCampaignID) {
			return;
		}
		setMembers(await request<CampaignMember[]>(`/api/campaigns/${activeCampaignID}/members`));
	};

	const loadHandouts = async () => {
		if (!activeCampaignID) {
			return;
		}
		setHandouts(await request<Handout[]>('/api/files/handouts', {
			headers: { 'x-stravsteel-campaign-id': activeCampaignID }
		}));
	};

	const loadCharacters = async () => {
		setCharacters(await request<CharacterSummary[]>('/api/characters/mine'));
	};

	useEffect(() => {
		Promise.all([
			request<UserSession>('/api/auth/session'),
			request<Campaign[]>('/api/campaigns')
		]).then(([ currentSession, availableCampaigns ]) => {
			setSession(currentSession);
			setCampaigns(availableCampaigns);
		}).catch(() => location.reload());
	}, []);

	useEffect(() => {
		const showUserManagement = () => setOpen(true);
		window.addEventListener('stravsteel:user-management', showUserManagement);
		window.addEventListener('stravsteel:my-campaigns', showUserManagement);
		return () => {
			window.removeEventListener('stravsteel:user-management', showUserManagement);
			window.removeEventListener('stravsteel:my-campaigns', showUserManagement);
		};
	}, []);

	useEffect(() => {
		if (open) {
			void Promise.all([ loadMembers(), loadHandouts(), loadCharacters() ]).catch(reason => {
				setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to load campaign members.' });
			});
		}
	}, [ open ]);

	const switchCampaign = (campaignID: string) => {
		localStorage.setItem('stravsteel-active-campaign', campaignID);
		location.reload();
	};

	const logout = async () => {
		await request('/api/auth/logout', { method: 'POST' });
		localStorage.removeItem('stravsteel-active-campaign');
		location.assign('/');
	};

	const createCampaign = async (values: CampaignValues) => {
		try {
			const campaign = await request<Campaign>('/api/campaigns', {
				method: 'POST',
				body: JSON.stringify(values)
			});
			localStorage.setItem('stravsteel-active-campaign', campaign.id);
			location.reload();
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to create campaign.' });
		}
	};

	const deleteCampaign = async (campaign: Campaign) => {
		if (!campaign.isOwner || campaign.isPersonal) {
			return;
		}
		try {
			await request(`/api/campaigns/${campaign.id}`, { method: 'DELETE' });
			if (campaign.id === activeCampaignID) {
				localStorage.setItem('stravsteel-active-campaign', session?.personalCampaignId ?? '');
				location.reload();
			} else {
				setCampaigns(current => current.filter(item => item.id !== campaign.id));
				setNotice({ type: 'success', text: `${campaign.name} was deleted.` });
			}
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to delete campaign.' });
		}
	};

	const addCharacter = async () => {
		if (!activeCampaignID || !selectedCharacterID) {
			return;
		}
		try {
			await request(`/api/campaigns/${activeCampaignID}/characters/${selectedCharacterID}`, { method: 'POST' });
			await loadCharacters();
			setSelectedCharacterID(undefined);
			setNotice({ type: 'success', text: 'Character added to this campaign.' });
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to add character.' });
		}
	};

	const createCharacter = () => {
		setOpen(false);
		window.dispatchEvent(new Event('stravsteel:create-character'));
	};

	const createInvitation = async (values: InvitationValues) => {
		if (!activeCampaignID) {
			return;
		}
		try {
			const result = await request<{ inviteUrl: string | null }>(
				`/api/campaigns/${activeCampaignID}/invitations`,
				{
					method: 'POST',
					body: JSON.stringify(values)
				}
			);
			setInviteUrl(result.inviteUrl ?? undefined);
			setNotice({
				type: 'success',
				text: result.inviteUrl
					? 'One-use invitation created.'
					: `${values.identifier} was invited to this campaign.`
			});
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to create invitation.' });
		}
	};

	const approveEmail = async ({ email }: { email: string }) => {
		try {
			await request('/api/admin/approvals', {
				method: 'POST',
				body: JSON.stringify({ email })
			});
			setNotice({ type: 'success', text: `${email} is approved to sign in.` });
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to approve email.' });
		}
	};

	const changeRole = async (member: CampaignMember, role: 'director' | 'player') => {
		if (!activeCampaignID) {
			return;
		}
		try {
			await request(`/api/campaigns/${activeCampaignID}/members/${member.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ role })
			});
			await loadMembers();
			setNotice({ type: 'success', text: `${member.displayName} is now a ${role}.` });
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to change role.' });
		}
	};

	const removeMember = async (member: CampaignMember) => {
		if (!activeCampaignID) {
			return;
		}
		try {
			await request(`/api/campaigns/${activeCampaignID}/members/${member.id}`, { method: 'DELETE' });
			await loadMembers();
			setNotice({ type: 'success', text: `${member.displayName} was removed from the campaign.` });
			if (member.id === session?.id) {
				location.assign('/');
			}
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to remove member.' });
		}
	};

	const uploadHandout = async (file: File) => {
		if (!activeCampaignID) {
			return;
		}
		const form = new FormData();
		form.append('file', file);
		setUploadingHandout(true);
		setNotice(undefined);
		try {
			const response = await fetch('/api/files/handouts', {
				method: 'POST',
				credentials: 'include',
				headers: { 'x-stravsteel-campaign-id': activeCampaignID },
				body: form
			});
			const body = await response.json() as { error?: string };
			if (!response.ok) {
				throw new Error(body.error ?? `${response.status} ${response.statusText}`);
			}
			await loadHandouts();
			setNotice({ type: 'success', text: `${file.name} was uploaded.` });
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to upload handout.' });
		} finally {
			setUploadingHandout(false);
		}
	};

	const deleteHandout = async (handout: Handout) => {
		try {
			await request(`/api/files/${handout.id}`, { method: 'DELETE' });
			await loadHandouts();
			setNotice({ type: 'success', text: `${handout.name} was deleted.` });
		} catch (reason) {
			setNotice({ type: 'error', text: reason instanceof Error ? reason.message : 'Unable to delete handout.' });
		}
	};

	return (
		<>
			<Modal
				open={open}
				title='My Campaigns'
				width={720}
				footer={null}
				onCancel={() => setOpen(false)}
			>
				<Space orientation='vertical' size='large' className='campaign-manager-content'>
					<Space wrap>
						<Avatar src={session?.avatarUrl}>{session?.displayName?.[0]}</Avatar>
						<div>
							<Typography.Text strong>{session?.displayName}</Typography.Text>
							<br />
							<Typography.Text type='secondary'>@{session?.username} · {session?.email}</Typography.Text>
						</div>
						{session?.siteRole === 'admin' ? <Tag color='gold'>Site Admin</Tag> : null}
						<Button icon={<LogoutOutlined />} onClick={logout}>Log out</Button>
					</Space>

					<Card size='small' title='Campaigns and characters'>
						<div className='campaign-manager-members'>
							{[ ...campaigns ]
								.sort((left, right) => Number(right.isPersonal) - Number(left.isPersonal))
								.map(campaign => (
									<div className='campaign-manager-member' key={campaign.id}>
										<div>
											<Typography.Text strong>
												{campaign.isPersonal ? 'My Characters' : campaign.name}
											</Typography.Text>
											<br />
											<Typography.Text type='secondary'>
												{campaign.isPersonal
													? 'Your private character workspace'
													: campaign.description || `${campaign.role} membership`}
											</Typography.Text>
										</div>
										<Space>
											{campaign.id === activeCampaignID ? <Tag color='green'>Active</Tag> : null}
											{campaign.isOwner && !campaign.isPersonal ? <Tag color='blue'>Owner</Tag> : null}
											{campaign.id !== activeCampaignID
												? <Button onClick={() => switchCampaign(campaign.id)}>Switch</Button>
												: null}
											{campaign.isOwner && !campaign.isPersonal
												? (
													<Popconfirm
														title={`Delete ${campaign.name}?`}
														description='This permanently deletes the campaign, its characters, sessions, encounters, handouts, and history.'
														okText='Delete campaign'
														okButtonProps={{ danger: true }}
														onConfirm={() => deleteCampaign(campaign)}
													>
														<Button danger icon={<DeleteOutlined />}>Delete</Button>
													</Popconfirm>
												)
												: null}
										</Space>
									</div>
								))}
						</div>
					</Card>

					<Card size='small' title={<Space><PlusOutlined />Create a campaign</Space>}>
						<Form<CampaignValues> layout='vertical' onFinish={createCampaign}>
							<Form.Item name='name' label='Campaign name' rules={[ { required: true, max: 120 } ]}>
								<Input />
							</Form.Item>
							<Form.Item name='description' label='Description (optional)' rules={[ { max: 1000 } ]}>
								<Input.TextArea rows={3} />
							</Form.Item>
							<Button type='primary' htmlType='submit'>Create campaign</Button>
						</Form>
					</Card>

					<Card size='small' title={<Space><TeamOutlined />Characters</Space>}>
						<Space orientation='vertical' style={{ width: '100%' }}>
							<Button type='primary' onClick={createCharacter}>Create a new character</Button>
							<Typography.Text type='secondary'>
								Create the character from Heroes; it will be saved to the active campaign.
							</Typography.Text>
							<Select
								placeholder='Choose one of your existing characters'
								value={selectedCharacterID}
								onChange={setSelectedCharacterID}
								options={characters
									.filter(character => character.campaignId !== activeCampaignID)
									.map(character => ({
										value: character.id,
										label: `${character.name} (currently in ${character.campaignName})`
									}))}
								style={{ width: '100%' }}
							/>
							<Button disabled={!selectedCharacterID} onClick={addCharacter}>Add existing character</Button>
						</Space>
					</Card>

					<Card size='small' title='Members'>
						<div className='campaign-manager-members'>
							{members.map(member => (
								<div className='campaign-manager-member' key={member.id}>
									<Space>
										<Avatar src={member.avatarUrl}>{member.displayName[0]}</Avatar>
										<div>
											<Typography.Text strong>{member.displayName}</Typography.Text>
											<br />
											<Typography.Text type='secondary'>
												{member.username ? `@${member.username} · ` : ''}{member.email}
											</Typography.Text>
										</div>
									</Space>
									{canManage
										? (
											<Space>
												<Select
													value={member.role}
													disabled={member.isOwner}
													onChange={role => void changeRole(member, role)}
													options={[
														{ value: 'player', label: 'Player' },
														{ value: 'director', label: 'Director' }
													]}
													style={{ width: 110 }}
												/>
												{member.isOwner
													? <Tag color='blue'>Owner</Tag>
													: (
														<Popconfirm
															title={`Remove ${member.displayName}?`}
															description='Their campaign characters will remain and become unassigned.'
															okText='Remove'
															okButtonProps={{ danger: true }}
															onConfirm={() => removeMember(member)}
														>
															<Button danger>Remove</Button>
														</Popconfirm>
													)}
											</Space>
										)
										: null}
								</div>
							))}
						</div>
					</Card>

					<Card size='small' title={<Space><PaperClipOutlined />Campaign Handouts</Space>}>
						<Space orientation='vertical' style={{ width: '100%' }}>
							{canManage
								? (
									<Upload
										showUploadList={false}
										beforeUpload={file => {
											void uploadHandout(file);
											return false;
										}}
									>
										<Button loading={uploadingHandout}>Upload Handout</Button>
									</Upload>
								)
								: null}
							{handouts.map(handout => (
								<div className='campaign-manager-member' key={handout.id}>
									<div>
										<Typography.Text strong>{handout.name}</Typography.Text>
										<br />
										<Typography.Text type='secondary'>
											{(handout.byteSize / 1024).toFixed(1)} KB
										</Typography.Text>
									</div>
									<Space>
										<Button icon={<DownloadOutlined />} href={handout.url}>Download</Button>
										{canManage
											? (
												<Popconfirm
													title={`Delete ${handout.name}?`}
													onConfirm={() => deleteHandout(handout)}
												>
													<Button danger icon={<DeleteOutlined />} />
												</Popconfirm>
											)
											: null}
									</Space>
								</div>
							))}
							{handouts.length === 0 ? <Typography.Text type='secondary'>No handouts yet.</Typography.Text> : null}
						</Space>
					</Card>

					{canManage
						? (
							<Card size='small' title={<Space><UserAddOutlined />Invite a campaign member</Space>}>
								<Form<InvitationValues>
									layout='vertical'
									initialValues={{ mode: 'link', role: 'player' }}
									onFinish={createInvitation}
									onValuesChange={values => {
										if (values.mode) {
											setInviteMode(values.mode as 'email' | 'link');
										}
									}}
								>
									<Form.Item name='mode' label='Invitation type'>
										<Select options={[
											{ value: 'link', label: 'One-use link (expires in 7 days)' },
											{ value: 'email', label: 'Invite by username or email' }
										]}
										/>
									</Form.Item>
									{inviteMode === 'email'
										? (
											<Form.Item name='identifier' label='Username or email' rules={[ { required: true, min: 3 } ]}>
												<Input placeholder='username or person@example.com' />
											</Form.Item>
										)
										: null}
									<Form.Item name='role' label='Campaign role'>
										<Select options={[
											{ value: 'player', label: 'Player' },
											{ value: 'director', label: 'Director' }
										]}
										/>
									</Form.Item>
									<Button type='primary' htmlType='submit'>Create invitation</Button>
								</Form>
								{inviteUrl
									? (
										<Space.Compact className='campaign-manager-invite-url'>
											<Input readOnly value={inviteUrl} />
											<Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy</Button>
										</Space.Compact>
									)
									: null}
							</Card>
						)
						: null}

					{session?.siteRole === 'admin'
						? (
							<>
								<Divider />
								<Card size='small' title='Approve site access'>
									<Typography.Paragraph type='secondary'>
										This permits sign-in without automatically adding the person to a campaign.
									</Typography.Paragraph>
									<Form layout='inline' onFinish={approveEmail}>
										<Form.Item name='email' rules={[ { required: true, type: 'email' } ]}>
											<Input placeholder='Google account email' />
										</Form.Item>
										<Button htmlType='submit'>Approve email</Button>
									</Form>
								</Card>
							</>
						)
						: null}

					{notice
						? (
							<Alert
								type={notice.type}
								showIcon
								title={notice.text}
								closable={{ onClose: () => setNotice(undefined) }}
							/>
						)
						: null}
				</Space>
			</Modal>
		</>
	);
};
