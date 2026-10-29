import { useContributionFailures, type ContributionFailure, type PluginDetailProps } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import type { ComponentType, ReactNode } from 'react'
import type { MarketplaceLocaleKey } from './locales.js'

type Translate = (key: MarketplaceLocaleKey, params?: Record<string, string | number>) => string

const failuresFor = (failures: readonly ContributionFailure[], subject: PluginDetailProps['subject']): readonly ContributionFailure[] =>
  subject.kind === 'item' ? [] : failures.filter(failure => failure.owner === subject.pkg.name)

/** A tag beside a plugin's title while any of its contributions failed. */
const createBadge =
  (t: Translate): ComponentType<PluginDetailProps> =>
  (props: PluginDetailProps): ReactNode => {
    const failures = failuresFor(useContributionFailures(), props.subject)
    if (failures.length === 0) return null
    return (
      <Badge variant="destructive" className="dshx-root" role="status">
        {t('failedContributions', { count: failures.length })}
      </Badge>
    )
  }

/** Which contributions of a plugin failed, and why. */
const createSection =
  (t: Translate): ComponentType<PluginDetailProps> =>
  (props: PluginDetailProps): ReactNode => {
    const failures = failuresFor(useContributionFailures(), props.subject)
    if (failures.length === 0) return null
    const title = t('failedContributionsTitle')
    return (
      <section aria-label={title} className="dshx-root dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
        <h3 className="dshx:font-semibold">{title}</h3>
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {failures.map(failure => (
            <li key={`${failure.kind}:${failure.id}`} className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-2">
              <code className="dshx:font-mono! dshx:text-xs">
                {failure.kind} {failure.id}
              </code>
              <span className="dshx:min-w-0 dshx:text-destructive">{failure.message}</span>
              <time className="dshx:text-muted-foreground dshx:text-xs" dateTime={new Date(failure.at).toISOString()}>
                {new Date(failure.at).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      </section>
    )
  }

export class ContributionFailuresModel {
  static readonly createBadge = createBadge
  static readonly createSection = createSection
}
