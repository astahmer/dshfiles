import { jjIntegrationSettings } from '@dshfiles/jj-integration/settings'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useSettings } from '@dshfiles/dshx/client'
import type { ReactNode } from 'react'
import { homeSettings, type HomeSettings } from './settings.js'

const Row = (props: { readonly title: string; readonly description: string; readonly children: ReactNode }) => (
  <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-6 dshx:border-b dshx:py-3">
    <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <span className="dshx:text-sm dshx:font-medium">{props.title}</span>
      <span className="dshx:text-xs dshx:text-muted-foreground">{props.description}</span>
    </div>
    <div className="dshx:shrink-0">{props.children}</div>
  </div>
)

/** One Settings page for everything about starting a thread, beside the native Agent presets page. */
export const NewThreadSettings = () => {
  const home = useSettings(homeSettings)
  const threads = useSettings(jjIntegrationSettings)
  const value: HomeSettings | undefined = home.value
  if (value === undefined)
    return (
      <div className="dshx-root dshx:p-1 dshx:text-sm dshx:text-muted-foreground">{home.status === 'loading' ? '…' : (home.error?.message ?? home.status)}</div>
    )
  const toggle = (field: 'showAgentPresetPicker' | 'showRecentThreads' | 'showUnlandedWork' | 'showPreviewBadge') => (
    <Switch checked={value[field]} disabled={!home.writable} onCheckedChange={checked => void home.set(field, checked)} />
  )
  return (
    <div className="dshx-root dshx:flex dshx:flex-col">
      {threads.value === undefined ? null : (
        <Row
          title="Own jj workspace by default"
          description="New threads in a jj repository start isolated in their own workspace; the toggle on the New thread row overrides it."
        >
          <Switch
            checked={threads.value.isolateByDefault}
            disabled={!threads.writable}
            onCheckedChange={checked => void threads.set('isolateByDefault', checked)}
          />
        </Row>
      )}
      <Row
        title="Agent preset picker"
        description="Show “Standard mode…” on the New thread row. Hidden, new threads use the Agent presets page’s New task default."
      >
        {toggle('showAgentPresetPicker')}
      </Row>
      <Row title="Recent threads" description="Offer the project’s three most recent threads above the composer.">
        {toggle('showRecentThreads')}
      </Row>
      <Row title="Work to land" description="Show how many of the project’s thread workspaces hold work not landed yet.">
        {toggle('showUnlandedWork')}
      </Row>
      <Row title="Headline" description="`{project}` is the selected project; empty keeps the DeepSeek headline.">
        <Input className="dshx:w-56" defaultValue={value.headline} onBlur={event => void home.set('headline', event.currentTarget.value)} />
      </Row>
      <Row title="Mark" description="What replaces the DeepSeek fish.">
        <Select value={value.mark} onValueChange={mark => void home.set('mark', mark === 'text' || mark === 'image' ? mark : 'none')}>
          <SelectTrigger className="dshx:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="text">Text or emoji</SelectItem>
            <SelectItem value="image">Image URL</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {value.mark === 'text' ? (
        <Row title="Mark text" description="Shown before the headline.">
          <Input className="dshx:w-56" defaultValue={value.markText} onBlur={event => void home.set('markText', event.currentTarget.value)} />
        </Row>
      ) : null}
      {value.mark === 'image' ? (
        <Row title="Mark image" description="An https: or data:image URL.">
          <Input className="dshx:w-56" defaultValue={value.markImageUrl} onBlur={event => void home.set('markImageUrl', event.currentTarget.value)} />
        </Row>
      ) : null}
      <Row title="Preview badge" description="Keep DeepSeek’s “Preview” badge next to the headline.">
        {toggle('showPreviewBadge')}
      </Row>
    </div>
  )
}
