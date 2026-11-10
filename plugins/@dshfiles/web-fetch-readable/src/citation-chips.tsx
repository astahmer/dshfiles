import { Browser, useContract } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { GlobeIcon } from '@dshfiles/plugin-ui/icons'
import type { MouseEvent } from 'react'
import type { CitationSource } from './citation-sources.js'

/**
 * One chip per page a web tool returned: host and title, the URL in a tooltip. The chip is a real link, so a plain or
 * modified click opens the page in a new tab; a click the browser pane beside the thread accepts stays there instead.
 */
export const CitationChips = (props: { readonly sources: readonly CitationSource[] }): JSX.Element | null => {
  const browser = useContract(Browser)
  if (props.sources.length === 0) return null
  const open = (event: MouseEvent<HTMLAnchorElement>, url: string): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return
    const pane = browser.status === 'active' ? browser.value : undefined
    if (pane?.open(url) !== true) return
    event.preventDefault()
  }
  return (
    <TooltipProvider>
      <div className="dshx-root dshx:@container dshx:flex dshx:flex-wrap dshx:gap-1.5 dshx:pt-1.5" data-web-citations="">
        {props.sources.map(source => (
          <Tooltip key={source.url}>
            <TooltipTrigger asChild>
              <Button asChild className="dshx:max-w-full dshx:shrink dshx:font-normal" data-web-citation={source.host} size="xs" variant="outline">
                <a
                  aria-label={source.title === undefined ? source.url : `${source.title} (${source.url})`}
                  href={source.url}
                  onAuxClick={event => open(event, source.url)}
                  onClick={event => open(event, source.url)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <GlobeIcon aria-hidden />
                  <span className="dshx:shrink-0 dshx:font-medium">{source.host}</span>
                  {source.title === undefined ? null : (
                    <span className="dshx:min-w-0 dshx:max-w-64 dshx:truncate dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{source.title}</span>
                  )}
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="dshx:max-w-sm dshx:break-all">{source.url}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
