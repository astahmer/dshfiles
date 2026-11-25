import * as React from 'react'
import { ChevronDownIcon, RefreshCwIcon } from 'lucide-react'
import { errorSentence } from '../lib/error-copy.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.js'

export interface LoadErrorProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
  /** What did not load, as the page names it: "Inbox", "Account order". */
  readonly subject: string
  /** The failure; its sentence comes from `errorSentence` and its raw text goes under Details. */
  readonly error?: unknown
  /** A sentence of the owner's own, for a case `errorSentence` cannot know (a destination whose plugin is missing). */
  readonly sentence?: string
  /** Shown as a Retry button; leave it out when retrying cannot change the outcome. */
  readonly onRetry?: () => void
  readonly retryLabel?: string
  /** What the user still has, appended to the sentence. */
  readonly kept?: string
  /** Further verbs after Retry: "Open Plugins", "Reload". */
  readonly actions?: React.ReactNode
}

/**
 * A page or section that did not load (DESIGN.md A page that did not load): one sentence that names the thing, Retry,
 * and the cause under Details. It replaces the content, so it never reads as an empty result.
 */
export const LoadError = React.forwardRef<HTMLDivElement, LoadErrorProps>(function LoadError(
  { subject, error, sentence, onRetry, retryLabel = 'Retry', kept, actions, className, ...props },
  ref,
) {
  const copy = error === undefined ? undefined : errorSentence(kept === undefined ? { subject, error } : { subject, error, kept })
  const text = sentence ?? copy?.sentence ?? `${subject} did not load.`
  const detail = copy?.detail ?? ''
  const retry = onRetry !== undefined && copy?.retry !== 'none'
  return (
    <div
      ref={ref}
      data-slot="load-error"
      data-error-kind={copy?.kind}
      className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:items-center dshx:gap-3 dshx:px-4 dshx:py-8 dshx:text-center', className)}
      {...props}
    >
      <p className="dshx:max-w-[56ch] dshx:text-sm dshx:text-balance dshx:text-foreground">{text}</p>
      {retry || actions !== undefined ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-center dshx:gap-2">
          {retry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              <RefreshCwIcon />
              {retryLabel}
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
      {detail === '' ? null : (
        <Collapsible className="dshx:flex dshx:w-full dshx:max-w-[64ch] dshx:flex-col dshx:items-center dshx:gap-2">
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="dshx:text-muted-foreground dshx:[&[data-state=open]>svg]:rotate-180">
              Details
              <ChevronDownIcon />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="dshx:w-full">
            <pre className="dshx:w-full dshx:overflow-x-auto dshx:rounded-md dshx:bg-muted dshx:p-3 dshx:text-left dshx:font-mono dshx:text-xs dshx:whitespace-pre-wrap dshx:text-muted-foreground">
              {detail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
})
