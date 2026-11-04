import { Page, PageSection, type PageAction, type PageTabs } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * One quota view, drawn either as its own page (ai-accounts' fallback pages, used when `@dshfiles/usage` is absent) or
 * as a section inside Observe › Usage › Quota, where the Usage page owns the header and the tabs. Embedded, the view's
 * own tabs become one segmented control and its actions small buttons beside its heading.
 */
export const QuotaViewFrame = (props: {
  readonly embedded: boolean
  readonly heading: ReactNode
  readonly description?: ReactNode
  readonly actions: readonly PageAction[]
  readonly tabs?: PageTabs
  readonly bodyClassName?: string
  readonly children: ReactNode
}): JSX.Element => {
  if (!props.embedded)
    return (
      <Page
        scroll
        heading={props.heading}
        description={props.description}
        actions={props.actions}
        {...(props.tabs === undefined ? {} : { tabs: props.tabs })}
        {...(props.bodyClassName === undefined ? {} : { bodyClassName: props.bodyClassName })}
      >
        {props.children}
      </Page>
    )
  const tabs = props.tabs
  return (
    <PageSection
      className="dshx:gap-3"
      heading={props.heading}
      description={props.description}
      actions={
        props.actions.length === 0
          ? undefined
          : props.actions.map(action => (
              <Button key={action.id} size="sm" variant="outline" disabled={action.disabled === true || action.pending === true} onClick={action.onSelect}>
                {action.pending === true ? <Spinner className="dshx:size-3.5" /> : action.icon}
                {action.label}
              </Button>
            ))
      }
    >
      {tabs === undefined ? null : (
        <div className="dshx:min-w-0 dshx:overflow-x-auto dshx:pb-0.5">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={tabs.label}
            value={tabs.value}
            onValueChange={value => {
              if (value !== '') tabs.onValueChange(value)
            }}
          >
            {tabs.items.map(item => (
              <ToggleGroupItem key={item.value} value={item.value} className="dshx:flex-none">
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <div className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3', props.bodyClassName)}>{props.children}</div>
    </PageSection>
  )
}
