import type { ChartQuery } from './api.js'

const GROUP_CAPTIONS = { model: 'model', provider: 'account', project: 'project', purpose: 'purpose' } satisfies Record<ChartQuery['groupBy'], string>

/** The trend chart's caption: its bucket and grouping as one line ("Daily · by model"), plus the estimate caveat for cost. */
export const trendCaption = (input: {
  readonly bucket: 'hour' | 'day'
  readonly groupBy: ChartQuery['groupBy']
  readonly metric: 'cost' | 'tokens' | 'requests'
}): string => `${input.bucket === 'hour' ? 'Hourly' : 'Daily'} · by ${GROUP_CAPTIONS[input.groupBy]}${input.metric === 'cost' ? ' · list-price estimate' : ''}`
