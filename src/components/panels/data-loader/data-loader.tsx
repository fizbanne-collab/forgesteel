import { Alert, Flex, Progress, Tag } from 'antd';
import { ConnectionSettings, FSDataSource } from '@/models/connection-settings';
import { SetStateAction, useEffect, useState } from 'react';
import { CheckIcon } from '@/components/controls/check-icon/check-icon';
import { CheckLabel } from '@/components/controls/check-label/check-label';
import { ConnectionSettingsUpdateLogic } from '@/logic/update/connection-settings-update-logic';
import { DataService } from '@/services/data-service';
import { FactoryLogic } from '@/logic/factory-logic';
import { HeaderText } from '@/components/controls/header-text/header-text';
import { Hero } from '@/models/hero';
import { HeroUpdateLogic } from '@/logic/update/hero-update-logic';
import { Options } from '@/models/options';
import { OptionsUpdateLogic } from '@/logic/update/options-update-logic';
import { Session } from '@/models/session';
import { SessionUpdateLogic } from '@/logic/update/session-update-logic';
import { Sourcebook } from '@/models/sourcebook';
import { SourcebookLogic } from '@/logic/sourcebook-logic';
import { SourcebookUpdateLogic } from '@/logic/update/sourcebook-update-logic';
import { StorageServiceFactory } from '@/services/storage/storage-service-factory';
import localforage from 'localforage';
import { useIsSmall } from '@/hooks/use-is-small';

import './data-loader.scss';

export interface LoadedData {
	connectionSettings: ConnectionSettings;
	service: DataService;
	heroes: Hero[];
	homebrewSourcebooks: Sourcebook[];
	hiddenSourcebookIDs: string[];
	session: Session;
	options: Options;
};

interface Props {
	onComplete: (data: LoadedData) => void;
}

type LoadingStatus = 'pending' | 'success' | 'failure' | undefined;

export const DataLoader = (props: Props) => {
	const [ connectionSettingsState, setConnectionSettingsState ] = useState<LoadingStatus>(undefined);
	const [ heroesState, setHeroesState ] = useState<LoadingStatus>(undefined);
	const [ heroesProgress, setHeroesProgress ] = useState<number>(0);
	const [ sourcebookState, setSourcebookState ] = useState<LoadingStatus>(undefined);
	const [ optionsState, setOptionsState ] = useState<LoadingStatus>(undefined);
	const [ sessionState, setSessionState ] = useState<LoadingStatus>(undefined);
	const [ hiddenSourcebookIDsState, setHiddenSourcebookIDsState ] = useState<LoadingStatus>(undefined);
	const [ overallLoadState, setOverallLoadState ] = useState<LoadingStatus>('pending');
	const [ dataSource, setDataSource ] = useState<FSDataSource>(undefined);
	const [ error, setError ] = useState<string | null>(null);
	const isSmall = useIsSmall();

	async function initializeConnectionSettings() {
		let settings = await localforage.getItem<ConnectionSettings>('forgesteel-connection-settings');
		if (!settings) {
			settings = FactoryLogic.createConnectionSettings();
		}
		ConnectionSettingsUpdateLogic.updateSettings(settings);

		const source: FSDataSource = 'StravSteel';
		// Don't show the tag for the oauth-redirect page
		const url = window.location.toString();
		if (!url.match(/oauth-redirect/)) {
			setDataSource(source);
		}
		settings.dataSource = source;

		return settings;
	};

	async function getDataService(settings: ConnectionSettings) {
		const storageSvc = StorageServiceFactory.fromConnectionSettings(settings);
		const service = new DataService(storageSvc);
		await service.initialize();
		return service;
	};

	async function updateLoadingStatus<T>(getterPromise: Promise<T>, setStateFunc: (value: SetStateAction<LoadingStatus>) => void): Promise<T> {
		return getterPromise
			.then(result => {
				setStateFunc('success');
				return result;
			})
			.catch(reason => {
				setStateFunc('failure');
				throw reason;
			});
	};

	async function getHeroUpdateProgress(getterPromise: Promise<Hero | null>, progressPercent: number): Promise<Hero | null> {
		return getterPromise
			.then(hero => {
				setHeroesProgress(heroesProgress => heroesProgress + progressPercent);
				return hero;
			})
			.catch(reason => {
				console.error('Error getting hero', reason);
				return null;
			});
	};

	async function getHeroes(dataService: DataService, source: FSDataSource): Promise<Hero[]> {
		// Only do multi-stage loading for non-local storage
		if (source === 'Local') {
			return dataService.getHeroes().finally(() => setHeroesProgress(100));
		}

		const heroPartials = await dataService.getHeroes();
		if (heroPartials.length === 0) {
			setHeroesProgress(100);
			return [];
		}
		const incrementPct = 100.0 / heroPartials.length;

		const getHeroPromises = heroPartials.map(p => {
			return getHeroUpdateProgress(dataService.getHero(p.id), incrementPct);
		});

		return Promise.all(getHeroPromises)
			.then(results => results.filter(h => !!h));
	};

	const loadData = () => {
		setError(null);
		setOverallLoadState('pending');
		setConnectionSettingsState('pending');

		setSourcebookState(undefined);
		setHeroesState(undefined);
		setSessionState(undefined);
		setOptionsState(undefined);
		setHiddenSourcebookIDsState(undefined);

		initializeConnectionSettings().then(settings => {
			getDataService(settings).then(dataService => {
				setConnectionSettingsState('success');

				setSourcebookState('pending');
				setHeroesState('pending');
				setSessionState('pending');
				setOptionsState('pending');
				setHiddenSourcebookIDsState('pending');

				const promises = [
					updateLoadingStatus(dataService.getHomebrew(), setSourcebookState),
					updateLoadingStatus(getHeroes(dataService, settings.dataSource), setHeroesState),
					updateLoadingStatus(dataService.getHiddenSourcebookIDs(), setHiddenSourcebookIDsState),
					updateLoadingStatus(dataService.getSession(), setSessionState),
					updateLoadingStatus(dataService.getOptions(), setOptionsState)
				];

				Promise.all(promises).then(results => {
					const sourcebooks = results[0] as Sourcebook[];
					sourcebooks.forEach(sourcebook => {
						try {
							SourcebookUpdateLogic.updateSourcebook(sourcebook);
						} catch (error) {
							console.error(`Error while updating sourcebook [${sourcebook.name} - ${sourcebook.id}]`, error);
						}
					});

					const heroes = results[1] as Hero[];
					heroes.forEach(hero => {
						try {
							HeroUpdateLogic.updateHero(hero, SourcebookLogic.getSourcebooks(sourcebooks));
						} catch (error) {
							console.error(`Error while updating hero [${hero.name} - ${hero.id}]`, error);
						}
					});

					const hiddenSourcebookIDs = results[2] as string[];

					const session = results[3] as Session;
					SessionUpdateLogic.updateSession(session);

					const options = results[4] as Options;
					OptionsUpdateLogic.updateOptions(options);
					if (isSmall) {
						options.compactView = true;
					}

					setOverallLoadState('success');

					props.onComplete({
						connectionSettings: settings,
						service: dataService,
						heroes: heroes,
						homebrewSourcebooks: sourcebooks,
						hiddenSourcebookIDs: hiddenSourcebookIDs,
						session: session,
						options: options
					});
				}).catch(reason => {
					console.error(reason);
					setError(reason.message);
					setOverallLoadState('failure');
				});
			}).catch(reason => {
				console.error(reason);
				setError(reason.message);
				setOverallLoadState('failure');
			});
		}).catch(reason => {
			console.error(reason);
			setError(reason.message);
			setOverallLoadState('failure');
		});
	};

	useEffect(
		loadData,
		// dependencies here needs to be an empty array so that it only runs once
		// otherwise, it runs several times as things change.
		[]
	);

	return (
		<div className='data-loader'>
			<div className='data-loader-container'>
				<div className='overall-state'>
					<CheckIcon state={overallLoadState} />
				</div>
				<HeaderText level={1}>Loading Data</HeaderText>
				<Flex vertical={true}>
					<Flex className='load-states' vertical={true}>
						<CheckLabel state={connectionSettingsState}>
							Connection Settings
							{
								dataSource ?
									<Tag variant='outlined'>{dataSource}</Tag>
									: null
							}
						</CheckLabel>
						<CheckLabel state={sourcebookState}>Sourcebooks</CheckLabel>
						<CheckLabel state={heroesState}>Heroes</CheckLabel>
						<Progress percent={heroesProgress} size='small' showInfo={false} />
						<CheckLabel state={sessionState}>Session</CheckLabel>
						<CheckLabel state={optionsState}>Options</CheckLabel>
						<CheckLabel state={hiddenSourcebookIDsState}>Manifold</CheckLabel>
					</Flex>
					{
						error ?
							<Alert
								type='error'
								showIcon={true}
								title='Data load error'
								description={error}
								style={{ width: '350px' }}
							/>
							: null
					}
				</Flex>
			</div>
		</div>
	);
};
