import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { AlertCircleIcon, AlertTriangleIcon, LockIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import { AGENT_GLYPHS, AgentEditor, type AgentField, type AgentFix, type AgentReview } from './agent-editor.js'
import { agentLimits, Agents, type Agent, type AgentDraft } from './agent.js'
import type { AgentPresetRow } from './api.js'
import type { AgentModelOption } from './dispatch.js'

/** The id of the control an issue belongs to, so the save bar can focus the first one that blocks a save. */
export const agentFieldId = (field: AgentField): string => `dshfiles-agent-field-${field}`
const DESCRIPTION_ID = 'dshfiles-agent-field-description'

const Section = (props: { readonly id: string; readonly title: string; readonly description: string; readonly children: ReactNode }): JSX.Element => (
  <section
    aria-labelledby={`${props.id}-title`}
    className="dshx:grid dshx:grid-cols-[13rem_minmax(0,1fr)] dshx:gap-x-8 dshx:gap-y-3 dshx:border-b dshx:border-border dshx:py-6 dshx:last:border-b-0 dshx:@max-pane-compact:grid-cols-1"
  >
    <div className="dshx:flex dshx:flex-col dshx:gap-1">
      <h3 id={`${props.id}-title`} className="dshx:text-sm dshx:font-semibold">
        {props.title}
      </h3>
      <p className="dshx:text-xs dshx:leading-relaxed dshx:text-muted-foreground">{props.description}</p>
    </div>
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">{props.children}</div>
  </section>
)

const IssueLine = (props: {
  readonly field: AgentField
  readonly review: AgentReview
  readonly hint?: ReactNode
  readonly onFix: (fix: AgentFix) => void
  /** Errors wait until the field was left or a save was tried; warnings always show. */
  readonly reveal: boolean
}): JSX.Element | null => {
  const raw = AgentEditor.issueFor(props.review, props.field)
  const found = raw !== null && raw.severity === 'error' && !props.reveal ? null : raw
  if (found === null) return props.hint === undefined ? null : <p className="dshx:text-xs dshx:leading-relaxed dshx:text-muted-foreground">{props.hint}</p>
  const error = found.severity === 'error'
  const fix = found.issue.fix
  const Icon = error ? AlertCircleIcon : AlertTriangleIcon
  return (
    <p
      id={`${agentFieldId(props.field)}-issue`}
      className={cn(
        'dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-xs dshx:leading-relaxed',
        error ? 'dshx:text-destructive' : 'dshx:text-warning',
      )}
    >
      <Icon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      <span className="dshx:min-w-0 dshx:flex-1">{found.issue.message}</span>
      {fix === undefined ? null : (
        <Button type="button" size="xs" variant="outline" onClick={() => props.onFix(fix)}>
          {fix.label}
        </Button>
      )}
    </p>
  )
}

/** A field heading: a real `<label>` for a native control, plain text above a combobox that names itself. */
const Label = (props: { readonly htmlFor?: string; readonly children: ReactNode; readonly aside?: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
    {props.htmlFor === undefined ? (
      <span aria-hidden className="dshx:text-sm dshx:font-medium">
        {props.children}
      </span>
    ) : (
      <label htmlFor={props.htmlFor} className="dshx:text-sm dshx:font-medium">
        {props.children}
      </label>
    )}
    {props.aside === undefined ? null : <span className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{props.aside}</span>}
  </div>
)

const describedBy = (review: AgentReview, field: AgentField, reveal: boolean) => {
  const found = AgentEditor.issueFor(review, field)
  if (found === null || (found.severity === 'error' && !reveal)) return {}
  const issueId = `${agentFieldId(field)}-issue`
  return found.severity === 'error' ? { 'aria-invalid': true, 'aria-describedby': issueId } : { 'aria-describedby': issueId }
}

export interface AgentEditorFormProps {
  readonly draft: AgentDraft
  readonly review: AgentReview
  readonly creating: boolean
  readonly agents: readonly Agent[]
  readonly catalog: readonly AgentModelOption[]
  readonly catalogError: string | null
  readonly presets: readonly AgentPresetRow[]
  readonly patch: (next: Partial<AgentDraft>) => void
  readonly onFix: (fix: AgentFix) => void
  /** True after a save was attempted, or for a saved agent, so every error shows at once. */
  readonly revealAll: boolean
}

/** The agent's settings in four sections: who it is, how it works, what it runs on, and how it reaches others. */
export const AgentEditorForm = (props: AgentEditorFormProps): JSX.Element => {
  const { draft, review, patch } = props
  // Peers keep the raw text while typing, so "reviewer, " is not reformatted before the next handle is typed.
  const [peersText, setPeersText] = useState(() => draft.delegation.handles.join(', '))
  const routeKey = draft.route === null ? '' : `${draft.route.provider}/${draft.route.model}`
  const routeOption = props.catalog.find(option => option.key === routeKey)
  const handleLocked = !props.creating
  const [touched, setTouched] = useState<ReadonlySet<AgentField>>(() => new Set())
  const touch = (field: AgentField): void => setTouched(previous => (previous.has(field) ? previous : new Set(previous).add(field)))
  const shown = (field: AgentField): boolean => props.revealAll || touched.has(field)

  const presetOptions: readonly ComboboxOption[] = [
    { value: '', label: 'Host default', description: 'the tools a plain thread gets' },
    ...props.presets.map(preset => ({
      value: preset.id,
      label: preset.name ?? preset.id,
      ...(preset.broken === undefined
        ? preset.description === undefined
          ? {}
          : { description: preset.description }
        : { description: `unavailable: ${preset.broken}` }),
      disabled: preset.broken !== undefined,
    })),
  ]
  const routeOptions: readonly ComboboxOption[] = [
    { value: '', label: 'Harness default', description: 'follows the thread default' },
    ...props.catalog.map(option => ({
      value: option.key,
      label: option.modelName,
      description: option.providerName,
      keywords: [option.provider, option.model, option.providerName],
      group: option.providerName,
    })),
    ...(draft.route !== null && routeOption === undefined ? [{ value: routeKey, label: draft.route.model, description: 'not offered by this Host' }] : []),
  ]
  const effortOptions: readonly ComboboxOption[] = [
    { value: '', label: routeOption?.defaultEffort === undefined ? 'Model default' : `Model default (${routeOption.defaultEffort})` },
    ...(routeOption?.efforts ?? []).map(effort => ({ value: effort, label: effort })),
  ]
  const otherAgents = props.agents.filter(agent => agent.handle !== review.handle)
  const memoryPlaceholder = Agents.defaultMemoryScope(review.handle)

  const setPeers = (text: string): void => {
    setPeersText(text)
    patch({ delegation: { ...draft.delegation, handles: AgentEditor.parsePeers(text) } })
  }
  const togglePeer = (handle: string): void => {
    const handles = draft.delegation.handles.includes(handle) ? draft.delegation.handles.filter(peer => peer !== handle) : [...draft.delegation.handles, handle]
    setPeersText(handles.join(', '))
    patch({ delegation: { ...draft.delegation, handles } })
  }

  return (
    <div className="dshx:flex dshx:flex-col">
      <Section id="dshfiles-agent-identity" title="Identity" description="How the agent shows up in lists, the @ menu and mention cards.">
        <div className="dshx:grid dshx:grid-cols-2 dshx:gap-4 dshx:@max-pane-narrow:grid-cols-1">
          <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
            <Label htmlFor={agentFieldId('name')} aside={`${String(draft.name.length)}/${String(agentLimits.name)}`}>
              Name
            </Label>
            <Input
              id={agentFieldId('name')}
              value={draft.name}
              maxLength={agentLimits.name}
              placeholder="e.g. Code reviewer"
              autoComplete="off"
              onChange={event => patch({ name: event.currentTarget.value })}
              {...describedBy(review, 'name', shown('name'))}
              onBlur={() => touch('name')}
            />
            <IssueLine reveal={shown('name')} field="name" review={review} onFix={props.onFix} />
          </div>
          <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
            <Label htmlFor={agentFieldId('handle')} aside={handleLocked ? <LockIcon aria-label="Fixed after creation" className="dshx:size-3" /> : undefined}>
              Handle
            </Label>
            <div className="dshx:relative">
              <span
                aria-hidden
                className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:left-3 dshx:-translate-y-1/2 dshx:font-mono dshx:text-sm dshx:text-muted-foreground"
              >
                @
              </span>
              <Input
                id={agentFieldId('handle')}
                value={draft.handle}
                readOnly={handleLocked}
                maxLength={32}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={Agents.handleFrom(draft.name === '' ? 'agent' : draft.name)}
                className={cn('dshx:pl-6 dshx:font-mono!', handleLocked && 'dshx:bg-muted/40 dshx:text-muted-foreground')}
                onChange={event => patch({ handle: AgentEditor.typedHandle(event.currentTarget.value) })}
                {...describedBy(review, 'handle', shown('handle'))}
                onBlur={() => touch('handle')}
              />
            </div>
            <IssueLine
              reveal={shown('handle')}
              field="handle"
              review={review}
              onFix={props.onFix}
              hint={
                handleLocked
                  ? 'The handle is the identity mentions point at, so it stays fixed.'
                  : `Mention it as @${review.handle}. It cannot change after saving.`
              }
            />
          </div>
        </div>

        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label htmlFor={agentFieldId('glyph')}>Glyph</Label>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
            <Input
              id={agentFieldId('glyph')}
              value={draft.glyph}
              maxLength={8}
              className="dshx:w-16 dshx:text-center"
              onChange={event => patch({ glyph: event.currentTarget.value })}
              {...describedBy(review, 'glyph', shown('glyph'))}
              onBlur={() => touch('glyph')}
            />
            <div role="group" aria-label="Glyph suggestions" className="dshx:flex dshx:flex-wrap dshx:gap-1">
              {AGENT_GLYPHS.map(glyph => (
                <Button
                  key={glyph}
                  type="button"
                  size="icon-sm"
                  variant={draft.glyph === glyph ? 'secondary' : 'ghost'}
                  aria-label={`Use glyph ${glyph}`}
                  aria-pressed={draft.glyph === glyph}
                  className="dshx:text-[15px]"
                  onClick={() => patch({ glyph })}
                >
                  {glyph}
                </Button>
              ))}
            </div>
          </div>
          <IssueLine reveal={shown('glyph')} field="glyph" review={review} onFix={props.onFix} />
        </div>

        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label htmlFor={DESCRIPTION_ID} aside={`${String(draft.description.length)}/${String(agentLimits.description)}`}>
            Description
          </Label>
          <Input
            id={DESCRIPTION_ID}
            value={draft.description}
            maxLength={agentLimits.description}
            placeholder="One line: what you would ask it for"
            onChange={event => patch({ description: event.currentTarget.value })}
          />
        </div>
      </Section>

      <Section
        id="dshfiles-agent-instructions"
        title="Instructions"
        description="The agent's standing brief. It opens every thread the agent starts, before your task."
      >
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label
            htmlFor={agentFieldId('instructions')}
            aside={`${draft.instructions.length.toLocaleString('en-US')}/${agentLimits.instructions.toLocaleString('en-US')}`}
          >
            Instructions
          </Label>
          <Textarea
            id={agentFieldId('instructions')}
            value={draft.instructions}
            maxLength={agentLimits.instructions}
            placeholder={'Role: what this agent is for.\nConstraints: what it must and must not do.\nOutput: the shape of a good answer.'}
            className="dshx:min-h-64 dshx:font-mono! dshx:text-sm dshx:leading-relaxed dshx:@max-pane-narrow:min-h-48"
            onChange={event => patch({ instructions: event.currentTarget.value })}
            {...describedBy(review, 'instructions', shown('instructions'))}
            onBlur={() => touch('instructions')}
          />
          <IssueLine
            reveal={shown('instructions')}
            field="instructions"
            review={review}
            onFix={props.onFix}
            hint="Plain text or Markdown. Agent edits apply to new threads only."
          />
        </div>
      </Section>

      <Section id="dshfiles-agent-runtime" title="Model and tools" description="What its threads run on. Leave them on default to follow the harness.">
        <div className="dshx:grid dshx:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] dshx:gap-4 dshx:@max-pane-narrow:grid-cols-1">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5">
            <Label>Model</Label>
            <Combobox
              label="Model route"
              matchTriggerWidth
              value={routeKey}
              options={routeOptions}
              searchAbove={0}
              searchPlaceholder="Search models or providers…"
              emptyLabel="No model matches."
              triggerClassName="dshx:h-9"
              onValueChange={value => {
                const option = props.catalog.find(candidate => candidate.key === value)
                if (option === undefined) {
                  patch({ route: null })
                  return
                }
                patch({
                  route:
                    option.defaultEffort === undefined
                      ? { provider: option.provider, model: option.model }
                      : { provider: option.provider, model: option.model, reasoningEffort: option.defaultEffort },
                })
              }}
            />
            <IssueLine
              reveal={shown('route')}
              field="route"
              review={review}
              onFix={props.onFix}
              hint={
                props.catalogError === null
                  ? undefined
                  : `The model list did not load (${props.catalogError}). Reopen the panel to retry; the saved route is kept.`
              }
            />
          </div>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5">
            <Label>Reasoning</Label>
            <Combobox
              label="Reasoning"
              matchTriggerWidth
              disabled={routeOption === undefined || routeOption.efforts.length === 0}
              value={draft.route?.reasoningEffort ?? ''}
              options={effortOptions}
              triggerClassName="dshx:h-9"
              onValueChange={value =>
                patch({
                  route:
                    draft.route === null
                      ? null
                      : value === ''
                        ? { provider: draft.route.provider, model: draft.route.model }
                        : { provider: draft.route.provider, model: draft.route.model, reasoningEffort: value },
                })
              }
            />
          </div>
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label>Tool preset</Label>
          <Combobox
            label="Tools (preset)"
            matchTriggerWidth
            value={draft.preset ?? ''}
            options={presetOptions}
            searchAbove={6}
            searchPlaceholder="Search presets…"
            triggerClassName="dshx:h-9"
            onValueChange={value => patch({ preset: value === '' ? null : value })}
          />
          <p className="dshx:text-xs dshx:text-muted-foreground">A preset decides which tools and system prompt a thread starts with.</p>
        </div>
      </Section>

      <Section
        id="dshfiles-agent-delegation"
        title="Delegation"
        description="Which agents its threads may message, and whether they may spawn subagents or workflows."
      >
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <span id="dshfiles-agent-messaging-label" className="dshx:text-sm dshx:font-medium">
            Messages
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-labelledby="dshfiles-agent-messaging-label"
            value={draft.delegation.messaging}
            className="dshx:w-full dshx:max-w-md"
            onValueChange={value => {
              if (value !== 'any' && value !== 'listed' && value !== 'none') return
              patch({ delegation: { ...draft.delegation, messaging: value } })
            }}
          >
            <ToggleGroupItem value="any" className="dshx:flex-1">
              Any agent
            </ToggleGroupItem>
            <ToggleGroupItem value="listed" className="dshx:flex-1">
              Only listed
            </ToggleGroupItem>
            <ToggleGroupItem value="none" className="dshx:flex-1">
              None
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {draft.delegation.messaging === 'listed' ? (
          <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
            <Label htmlFor={agentFieldId('peers')}>Peers (handles)</Label>
            <Input
              id={agentFieldId('peers')}
              value={peersText}
              placeholder="reviewer, planner"
              autoCapitalize="none"
              spellCheck={false}
              className="dshx:font-mono!"
              onChange={event => setPeers(event.currentTarget.value)}
              onBlur={() => {
                setPeersText(draft.delegation.handles.join(', '))
                touch('peers')
              }}
              {...describedBy(review, 'peers', shown('peers'))}
            />
            {otherAgents.length === 0 ? null : (
              <div role="group" aria-label="Saved agents" className="dshx:flex dshx:flex-wrap dshx:gap-1">
                {otherAgents.map(agent => (
                  <Button
                    key={agent.handle}
                    type="button"
                    size="xs"
                    variant={draft.delegation.handles.includes(agent.handle) ? 'secondary' : 'outline'}
                    aria-pressed={draft.delegation.handles.includes(agent.handle)}
                    onClick={() => togglePeer(agent.handle)}
                  >
                    <span aria-hidden>{agent.glyph}</span>@{agent.handle}
                  </Button>
                ))}
              </div>
            )}
            <IssueLine reveal={shown('peers')} field="peers" review={review} onFix={props.onFix} hint="Type handles or tap a saved agent." />
          </div>
        ) : (
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {draft.delegation.messaging === 'any'
              ? 'Its threads may message and broadcast to any agent.'
              : 'Its threads cannot message or broadcast to other agents.'}
          </p>
        )}

        <label className="dshx:flex dshx:items-start dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3">
          <Switch
            className="dshx:mt-0.5"
            aria-label="Subagents and workflows"
            checked={draft.delegation.subagents}
            onCheckedChange={subagents => patch({ delegation: { ...draft.delegation, subagents } })}
          />
          <span className="dshx:flex dshx:flex-col dshx:gap-0.5">
            <span className="dshx:text-sm dshx:font-medium">Subagents and workflows</span>
            <span className="dshx:text-xs dshx:text-muted-foreground">
              {draft.delegation.subagents
                ? 'Its threads may hand work to subagents and run workflows.'
                : 'Subagent and workflow calls are refused before they start.'}
            </span>
          </span>
        </label>
      </Section>

      <Section id="dshfiles-agent-memory" title="Memory and routine" description="Notes its threads read, and a standing task they keep with DSH's schedules.">
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label htmlFor={agentFieldId('memoryScope')}>Memory scope</Label>
          <Input
            id={agentFieldId('memoryScope')}
            value={draft.memoryScope ?? ''}
            placeholder={memoryPlaceholder}
            autoCapitalize="none"
            spellCheck={false}
            className="dshx:font-mono!"
            onChange={event => patch({ memoryScope: event.currentTarget.value === '' ? null : event.currentTarget.value })}
            {...describedBy(review, 'memoryScope', shown('memoryScope'))}
            onBlur={() => touch('memoryScope')}
          />
          <IssueLine
            reveal={shown('memoryScope')}
            field="memoryScope"
            review={review}
            onFix={props.onFix}
            hint={`Its threads read the project's notes plus this scope's. Empty uses ${memoryPlaceholder}.`}
          />
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Label htmlFor={agentFieldId('routine')} aside={`${String(draft.routine.length)}/${String(agentLimits.routine)}`}>
            Routine
          </Label>
          <Textarea
            id={agentFieldId('routine')}
            value={draft.routine}
            maxLength={agentLimits.routine}
            rows={2}
            placeholder="Every weekday at 09:00, summarise open reviews."
            onChange={event => patch({ routine: event.currentTarget.value })}
            {...describedBy(review, 'routine', shown('routine'))}
            onBlur={() => touch('routine')}
          />
          <IssueLine
            reveal={shown('routine')}
            field="routine"
            review={review}
            onFix={props.onFix}
            hint="Optional. A thread started by this agent schedules it with its own reminder tools; there is no timer here."
          />
        </div>
      </Section>
    </div>
  )
}
