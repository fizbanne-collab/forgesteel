import { Alert, AutoComplete, Button, Flex, Space, Upload } from 'antd';
import { Collections } from '@/utils/collections';
import { DangerButton } from '@/components/controls/danger-button/danger-button';
import { DownloadOutlined } from '@ant-design/icons';
import { Expander } from '@/components/controls/expander/expander';
import { FactoryLogic } from '@/logic/factory-logic';
import { FeatureConfigPanel } from '@/components/panels/feature-config-panel/feature-config-panel';
import { FeatureData } from '@/models/feature';
import { FeatureType } from '@/enums/feature-type';
import { HeaderText } from '@/components/controls/header-text/header-text';
import { Hero } from '@/models/hero';
import { HeroLogic } from '@/logic/hero-logic';
import { NameSuggestions } from '@/components/panels/name-suggestions/name-suggestions';
import { SelectablePanel } from '@/components/controls/selectable-panel/selectable-panel';
import { Sourcebook } from '@/models/sourcebook';
import { TextInput } from '@/components/controls/text-input/text-input';
import { useHeroes } from '@/contexts/data-context';
import { useState } from 'react';

import './details-section.scss';

interface DetailsSectionProps {
	hero: Hero;
	sourcebooks: Sourcebook[];
	setName: (value: string) => void;
	setPicture: (value: string | null) => void;
	setFolder: (value: string) => void;
	setFeatureData: (featureID: string, data: FeatureData) => void;
}

export const DetailsSection = (props: DetailsSectionProps) => {
	const [ portraitError, setPortraitError ] = useState<string>();
	const [ uploadingPortrait, setUploadingPortrait ] = useState(false);
	const allHeroes = useHeroes();
	const folders = allHeroes
		.map(h => h.folder)
		.filter(f => !!f)
		.sort();

	const uploadPortrait = async (file: File) => {
		const campaignID = localStorage.getItem('stravsteel-active-campaign') ?? '';
		const form = new FormData();
		form.append('file', file);
		setUploadingPortrait(true);
		setPortraitError(undefined);
		try {
			const response = await fetch(`/api/files/portraits/${encodeURIComponent(props.hero.id)}`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'x-stravsteel-campaign-id': campaignID },
				body: form
			});
			const result = await response.json() as { error?: string; url?: string };
			if (!response.ok || !result.url) {
				throw new Error(result.error ?? `${response.status} ${response.statusText}`);
			}
			props.setPicture(`${result.url}?v=${Date.now()}`);
		} catch (reason) {
			setPortraitError(reason instanceof Error ? reason.message : 'Unable to upload portrait.');
		} finally {
			setUploadingPortrait(false);
		}
	};

	const clearPortrait = async () => {
		const match = props.hero.picture?.match(/^\/api\/files\/([^?]+)/);
		if (match) {
			await fetch(`/api/files/${encodeURIComponent(match[1])}`, {
				method: 'DELETE',
				credentials: 'include'
			});
		}
		props.setPicture(null);
	};

	return (
		<div className='hero-edit-content details-section'>
			<div className='hero-edit-content-column selected' id='details-main'>
				<SelectablePanel>
					<HeaderText>Name</HeaderText>
					<Space.Compact style={{ width: '100%' }}>
						<TextInput
							status={props.hero.name === '' ? 'warning' : ''}
							placeholder='Name'
							allowClear={true}
							value={props.hero.name}
							onChange={props.setName}
						/>
						<NameSuggestions onSelect={props.setName} />
					</Space.Compact>
				</SelectablePanel>
				<SelectablePanel>
					<HeaderText>Portrait</HeaderText>
					{
						props.hero.picture ?
							<Flex align='center' justify='center' gap={10}>
								<img className='portrait-edit' src={props.hero.picture} title='Portrait' />
								<DangerButton mode='clear' onConfirm={clearPortrait} />
							</Flex>
							:
							<Upload
								style={{ width: '100%' }}
								accept='.png,.webp,.gif,.jpg,.jpeg'
								showUploadList={false}
								beforeUpload={file => {
									void uploadPortrait(file);
									return false;
								}}
							>
								<Button loading={uploadingPortrait}>
									<DownloadOutlined />
									Choose a picture
								</Button>
							</Upload>
					}
					{portraitError ? <Alert type='error' showIcon title={portraitError} /> : null}
				</SelectablePanel>
				<SelectablePanel>
					<HeaderText>Folder</HeaderText>
					<AutoComplete
						options={Collections.distinct(folders, f => f).map(option => ({ value: option, label: option }))}
						optionRender={o => <div className='ds-text'>{o.data.label}</div>}
						placeholder='Folder'
						allowClear={true}
						showSearch={{ filterOption: true }}
						value={props.hero.folder}
						onSelect={props.setFolder}
						onChange={props.setFolder}
					/>
					<div className='ds-text'>
						<Alert
							type='info'
							showIcon={true}
							title='You can add your hero to a folder to group it with other heroes.'
						/>
					</div>
				</SelectablePanel>
			</div>
			<div className='hero-edit-content-column selected'>
				<Expander title='Language Choices'>
					{
						HeroLogic.getFeatures(props.hero)
							.map(f => f.feature)
							.filter(f => f.type === FeatureType.LanguageChoice)
							.map(f => {
								return FactoryLogic.feature.createLanguageChoice({
									id: f.id,
									name: f.name || 'Language',
									description: `${f.data.options.length > 0 ? `**Skills**: ${f.data.options.join(', ')}` : ''}`,
									options: [ ...f.data.options ],
									count: f.data.count,
									selected: [ ...f.data.selected ]
								});
							})
							.map(f => (
								<FeatureConfigPanel
									key={f.id}
									feature={f}
									hero={props.hero}
									sourcebooks={props.sourcebooks}
									setData={props.setFeatureData}
								/>
							))
					}
				</Expander>
				<Expander title='Skill Choices'>
					{
						HeroLogic.getFeatures(props.hero)
							.map(f => f.feature)
							.filter(f => f.type === FeatureType.SkillChoice)
							.map(f => {
								return FactoryLogic.feature.createSkillChoice({
									id: f.id,
									name: 'Skill',
									description: `
${f.data.options.length > 0 ? `**Skills**: ${f.data.options.join(', ')}` : ''}
${f.data.listOptions.length > 0 ? `**Lists**: ${f.data.listOptions.map(s => `${s} Skills`).join(', ')}` : ''}`,
									options: [ ...f.data.options ],
									listOptions: [ ...f.data.listOptions ],
									count: f.data.count,
									selected: [ ...f.data.selected ]
								});
							})
							.map(f => (
								<FeatureConfigPanel
									key={f.id}
									feature={f}
									hero={props.hero}
									sourcebooks={props.sourcebooks}
									setData={props.setFeatureData}
								/>
							))
					}
				</Expander>
			</div>
		</div>
	);
};
