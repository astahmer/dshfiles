import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { z } from 'zod'
import { settingsShellApi } from './shell-api.js'
import type { ShellTranslate } from './native/locales.js'

const RELEASE_STATUS_QUERY_KEY = ['settings-shell', 'release-status'] as const
const RELEASE_STATUS_REFRESH_MS = 6 * 60 * 60 * 1000
const dismissedRelease = createStoredValue({ key: 'dshfiles.settings-shell.dismissed-release.v1', schema: z.string().max(100), fallback: '' })

const useReleaseStatus = () => {
  const api = useApi(settingsShellApi)
  return useQuery({
    queryKey: RELEASE_STATUS_QUERY_KEY,
    queryFn: ({ signal }) => api.releaseStatus(undefined, { signal }),
    staleTime: 60 * 60 * 1000,
    refetchInterval: RELEASE_STATUS_REFRESH_MS,
  })
}

export const DshReleaseIndicator = (props: { readonly t: ShellTranslate }): JSX.Element | null => {
  const status = useReleaseStatus()
  const dismissed = dismissedRelease.useValue()
  const version = status.data?.available === true && status.data.latestVersion !== dismissed ? status.data.latestVersion : null
  if (version === null) return null
  const label = props.t('releaseNotice.badge', { version })
  return (
    <Tooltip label={label} side="right">
      <span aria-label={label} className="dshx:absolute dshx:end-0 dshx:top-0 dshx:size-1.5 dshx:rounded-full dshx:bg-warning" role="img" />
    </Tooltip>
  )
}

export const DshReleaseNotice = (props: { readonly t: ShellTranslate }): JSX.Element => {
  const status = useReleaseStatus()
  const dismissed = dismissedRelease.useValue()
  const [expanded, setExpanded] = useState(false)
  const releaseStatus = status.data
  const updateAvailable = releaseStatus?.available === true && releaseStatus.latestVersion !== dismissed
  const highlights =
    releaseStatus?.releases.flatMap(release => release.highlights.map(highlight => ({ ...highlight, version: release.version }))).slice(0, 8) ?? []
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:py-4" data-dsh-release-notice="">
      <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-4">
        <div className="dshx:min-w-0 dshx:flex-1">
          <div className="dshx:text-[14px] dshx:leading-5 dshx:font-medium">
            {updateAvailable
              ? props.t('releaseNotice.available', { version: releaseStatus.latestVersion ?? '' })
              : status.isError
                ? props.t('releaseNotice.failed')
                : releaseStatus?.comparisonKnown === false
                  ? props.t('releaseNotice.unknown', { version: releaseStatus.currentVersion ?? '' })
                  : releaseStatus?.comparisonKnown === true
                    ? props.t('releaseNotice.current', { version: releaseStatus.currentVersion ?? '' })
                    : props.t('releaseNotice.checking')}
          </div>
          {updateAvailable && (
            <div className="dshx:mt-1 dshx:text-[12px] dshx:leading-[18px] dshx:text-muted-foreground">
              {props.t('releaseNotice.compare', { current: releaseStatus.currentVersion ?? '', latest: releaseStatus.latestVersion ?? '' })}
            </div>
          )}
        </div>
        {updateAvailable && (
          <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
            <Button aria-expanded={expanded} onClick={() => setExpanded(value => !value)} size="sm" variant="outline">
              {expanded ? props.t('releaseNotice.hideSummary') : props.t('releaseNotice.showSummary')}
              {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
            <Button
              aria-label={props.t('releaseNotice.dismiss', { version: releaseStatus.latestVersion ?? '' })}
              onClick={() => {
                if (releaseStatus.latestVersion !== null) dismissedRelease.set(releaseStatus.latestVersion)
              }}
              size="icon-sm"
              variant="ghost"
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        )}
      </div>
      {expanded && updateAvailable && (
        <div className="dshx:flex dshx:flex-col dshx:gap-2" data-dsh-release-summary="">
          {highlights.length === 0 ? (
            <p className="dshx:m-0 dshx:text-[12px] dshx:text-muted-foreground">{props.t('releaseNotice.noHighlights')}</p>
          ) : (
            <ul className="dshx:m-0 dshx:flex dshx:flex-col dshx:gap-1 dshx:ps-5 dshx:text-[12px] dshx:leading-[18px]">
              {highlights.map((highlight, index) => (
                <li key={`${highlight.version}-${index}`}>
                  <span className="dshx:font-medium">
                    {highlight.section} · {highlight.version}:
                  </span>{' '}
                  {highlight.text}
                </li>
              ))}
            </ul>
          )}
          {releaseStatus.latestUrl !== null && (
            <a
              className="dshx:inline-flex dshx:w-fit dshx:items-center dshx:gap-1 dshx:text-[12px] dshx:text-primary dshx:underline dshx:underline-offset-2"
              href={releaseStatus.latestUrl}
              rel="noreferrer"
              target="_blank"
            >
              {props.t('releaseNotice.releaseNotes')} <ExternalLinkIcon size={12} />
            </a>
          )}
        </div>
      )}
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3">
        <Button disabled={status.isFetching} onClick={() => void status.refetch()} size="sm" variant="ghost">
          {props.t(status.isFetching ? 'releaseNotice.checking' : 'releaseNotice.check')}
        </Button>
        {status.isError && (
          <span className="dshx:text-[12px] dshx:text-muted-foreground" role="status">
            {props.t('releaseNotice.retryHint')}
          </span>
        )}
      </div>
    </section>
  )
}
