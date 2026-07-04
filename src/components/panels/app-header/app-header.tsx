import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { LogoPanel } from '@/components/panels/logo/logo-panel';
import { ReactNode } from 'react';

import './app-header.scss';

interface Props {
	subheader?: string;
	children?: ReactNode;
}

export const AppHeader = (props: Props) => {
	return (
		<ErrorBoundary>
			<div className='app-header'>
				<div className='left-section'>
					<LogoPanel />
					<div className='navigation-section' />
				</div>
				<div className='right-section'>
					{props.children}
					<div className='global-actions-section' />
				</div>
			</div>
		</ErrorBoundary>
	);
};
