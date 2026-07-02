import { Alert, Button, Empty, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { HistoryOutlined, RollbackOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Hero } from '@/models/hero';
import type { Operation } from 'fast-json-patch';

interface HistoryEntry {
	revision: number;
	patch: Operation[];
	changedAt: string;
	changedById: string;
	changedByName: string;
}

interface Props {
	hero: Hero;
	open: boolean;
	onClose: () => void;
}

export const CharacterHistoryModal = ({ hero, open, onClose }: Props) => {
	const [ entries, setEntries ] = useState<HistoryEntry[]>([]);
	const [ loading, setLoading ] = useState(false);
	const [ error, setError ] = useState<string>();
	const campaignID = localStorage.getItem('stravsteel-active-campaign') ?? '';

	const loadHistory = async () => {
		setLoading(true);
		setError(undefined);
		try {
			const response = await fetch(`/api/storage/heroes/${encodeURIComponent(hero.id)}/history`, {
				credentials: 'include',
				headers: { 'x-stravsteel-campaign-id': campaignID }
			});
			const body = await response.json() as HistoryEntry[] | { error?: string };
			if (!response.ok) {
				throw new Error('error' in body ? body.error : `${response.status} ${response.statusText}`);
			}
			setEntries(body as HistoryEntry[]);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Unable to load character history.');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (open) {
			void loadHistory();
		}
	}, [ open, hero.id ]);

	const restore = async (revision: number) => {
		setLoading(true);
		setError(undefined);
		try {
			const response = await fetch(
				`/api/storage/heroes/${encodeURIComponent(hero.id)}/history/${revision}/restore`,
				{
					method: 'POST',
					credentials: 'include',
					headers: { 'x-stravsteel-campaign-id': campaignID }
				}
			);
			if (!response.ok) {
				const body = await response.json().catch(() => null) as { error?: string } | null;
				throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
			}
			await loadHistory();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Unable to restore this revision.');
			setLoading(false);
		}
	};

	const describePatch = (patch: Operation[]) => {
		if (patch.length === 0) {
			return 'Character created';
		}
		const paths = patch
			.map(operation => operation.path || 'entire character')
			.slice(0, 4);
		return `${paths.join(', ')}${patch.length > paths.length ? ` and ${patch.length - paths.length} more` : ''}`;
	};

	return (
		<Modal
			open={open}
			title={<Space><HistoryOutlined />Character History</Space>}
			footer={null}
			onCancel={onClose}
			loading={loading}
			closable
		>
			<Space orientation='vertical' size='middle' style={{ width: '100%' }}>
				{error ? <Alert type='error' showIcon title={error} /> : null}
				{entries.map(entry => (
					<div key={entry.revision} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
						<div>
							<Space>
								<Tag>Revision {entry.revision}</Tag>
								<Typography.Text strong>{entry.changedByName}</Typography.Text>
							</Space>
							<br />
							<Typography.Text type='secondary'>
								{new Date(entry.changedAt).toLocaleString()} · {describePatch(entry.patch)}
							</Typography.Text>
						</div>
						<Popconfirm
							title={`Restore revision ${entry.revision}?`}
							description='The current character will be retained as another history entry.'
							onConfirm={() => restore(entry.revision)}
						>
							<Button icon={<RollbackOutlined />}>Restore</Button>
						</Popconfirm>
					</div>
				))}
				{!loading && entries.length === 0 ? <Empty description='No saved history yet' /> : null}
			</Space>
		</Modal>
	);
};
