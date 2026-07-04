import { AppGate, UserSession } from '@/components/app-gate/app-gate';
import { DataLoader } from '@/components/panels/data-loader/data-loader';
import { DataManagerProvider } from './contexts/data-context';
import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { HashRouter } from 'react-router';
import { Main } from '@/components/main/main.tsx';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeTheme } from '@/utils/initialize-theme';

import './index.scss';

initializeTheme();

// Register the PWA worker only in production. A development worker can keep
// serving a stale application after authentication or routing changes.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js')
			.catch(registrationError => {
				console.error('SW registration failed: ', registrationError);
			});
	});
} else if ('serviceWorker' in navigator) {
	void navigator.serviceWorker.getRegistrations()
		.then(registrations => Promise.all(registrations.map(registration => registration.unregister())));
	void caches.keys()
		.then(names => Promise.all(
			names
				.filter(name => name.startsWith('forgesteel-') || name.startsWith('stravsteel-'))
				.map(name => caches.delete(name))
		));
}

const root = createRoot(document.getElementById('root')!);

const renderApplication = (userSession: UserSession) => {
	root.render(
		<ErrorBoundary>
			<StrictMode>
				<DataLoader
					onComplete={data => {
						root.render(
							<ErrorBoundary>
								<StrictMode>
									<HashRouter>
										<DataManagerProvider
											dataService={data.service}
											initialOptions={data.options}
											initialSession={data.session}
											initialHeroes={data.heroes}
											initialHomebrewSourcebooks={data.homebrewSourcebooks}
											initialHiddenSourcebookIDs={data.hiddenSourcebookIDs}
										>
											<Main
												connectionSettings={data.connectionSettings}
												dataService={data.service}
												userSession={userSession}
											/>
										</DataManagerProvider>
									</HashRouter>
								</StrictMode>
							</ErrorBoundary>
						);
					}}
				/>
			</StrictMode>
		</ErrorBoundary>
	);
};

root.render(
	<ErrorBoundary>
		<StrictMode>
			<AppGate onReady={renderApplication} />
		</StrictMode>
	</ErrorBoundary>
);
