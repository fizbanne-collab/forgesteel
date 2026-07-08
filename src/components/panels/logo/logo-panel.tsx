import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';

import './logo-panel.scss';

interface Props {
	text?: string;
}

export const LogoPanel = (props: Props) => {
	const text = props.text || 'DRAW STEEL';

	return (
		<ErrorBoundary>
			<div className='logo-panel'>
				<svg className='logo-panel-mark' viewBox='0 0 96 96' role='img' aria-label='Draw Steel animated logo mark'>
					<defs>
						<linearGradient id='drawsteel-mark-steel' x1='16' y1='10' x2='80' y2='88' gradientUnits='userSpaceOnUse'>
							<stop offset='0' stopColor='#ffffff' />
							<stop offset='0.42' stopColor='#9fb4c8' />
							<stop offset='1' stopColor='#344558' />
						</linearGradient>
						<linearGradient id='drawsteel-mark-arcane' x1='20' y1='74' x2='76' y2='24' gradientUnits='userSpaceOnUse'>
							<stop offset='0' stopColor='var(--app-accent, #68e8ff)' />
							<stop offset='1' stopColor='var(--app-accent-2, #b789ff)' />
						</linearGradient>
						<filter id='drawsteel-mark-glow' x='-40%' y='-40%' width='180%' height='180%'>
							<feGaussianBlur stdDeviation='2.8' result='blur' />
							<feMerge>
								<feMergeNode in='blur' />
								<feMergeNode in='SourceGraphic' />
							</feMerge>
						</filter>
					</defs>

					<path className='logo-panel-shield' d='M48 8 L80 20 V43 C80 63 68 78 48 88 C28 78 16 63 16 43 V20 Z' />
					<path className='logo-panel-shield-inner' d='M48 16 L70 25 V43 C70 58 62 69 48 77 C34 69 26 58 26 43 V25 Z' />
					<g className='logo-panel-compass'>
						<path d='M48 11 L52 24 L48 29 L44 24 Z' />
						<path d='M48 85 L52 72 L48 67 L44 72 Z' />
						<path d='M11 48 L24 44 L29 48 L24 52 Z' />
						<path d='M85 48 L72 44 L67 48 L72 52 Z' />
					</g>

					<g className='logo-panel-sword' filter='url(#drawsteel-mark-glow)'>
						<path className='logo-panel-sword-blade' d='M48 12 L56 52 L48 72 L40 52 Z' />
						<path className='logo-panel-sword-core' d='M48 18 L51 52 L48 63 L45 52 Z' />
						<path className='logo-panel-sword-guard' d='M29 54 L67 54 L62 61 H34 Z' />
						<path className='logo-panel-sword-pommel' d='M48 70 L55 78 L48 86 L41 78 Z' />
					</g>

					<g className='logo-panel-die logo-panel-d10' filter='url(#drawsteel-mark-glow)'>
						<path className='logo-panel-die-face' d='M48 16 L70 36 L62 68 L48 80 L34 68 L26 36 Z' />
						<path className='logo-panel-die-line' d='M48 16 L48 80 M26 36 L48 48 L70 36 M34 68 L48 48 L62 68 M26 36 L34 68 M70 36 L62 68' />
						<text x='48' y='56' textAnchor='middle'>10</text>
					</g>
				</svg>
				<div className='logo-panel-text' aria-label={text}>
					{
						text === 'DRAW STEEL' ?
							<>
								<span>DRAW</span>
								<span>STEEL</span>
							</>
							: text
					}
				</div>
			</div>
		</ErrorBoundary>
	);
};
