import { Button, Card, Space, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { useState } from 'react';

import './export-page.scss';

export const ExportPage = () => {
	const [ exporting, setExporting ] = useState(false);
	const [ error, setError ] = useState<string>();

	const exportCampaign = async () => {
		const campaignID = localStorage.getItem('stravsteel-active-campaign');
		if (!campaignID) {
			setError('Choose an active campaign before exporting data.');
			return;
		}

		setExporting(true);
		setError(undefined);
		try {
			const response = await fetch('/api/storage/export', {
				credentials: 'include',
				headers: { 'x-stravsteel-campaign-id': campaignID }
			});
			if (!response.ok) {
				const body = await response.json().catch(() => null) as { error?: string } | null;
				throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
			}
			const data = await response.json() as unknown;
			const blob = new Blob([ JSON.stringify(data, null, 2) ], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `stravsteel-campaign-${new Date().toISOString().slice(0, 10)}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Unable to export campaign data.');
		} finally {
			setExporting(false);
		}
	};

	return (
		<ErrorBoundary>
			<div className='export-page'>
				<Card className='export-page-card'>
					<Space orientation='vertical' size='large'>
						<Typography.Title level={2}>Export Campaign Data</Typography.Title>
						<Typography.Paragraph>
							Download a portable JSON copy of this campaign's characters, sourcebooks, and session data.
						</Typography.Paragraph>
						<Button
							type='primary'
							icon={<DownloadOutlined />}
							loading={exporting}
							onClick={exportCampaign}
						>
							Download JSON Export
						</Button>
						{error ? <Typography.Text type='danger'>{error}</Typography.Text> : null}
					</Space>
				</Card>
			</div>
		</ErrorBoundary>
	);
};
