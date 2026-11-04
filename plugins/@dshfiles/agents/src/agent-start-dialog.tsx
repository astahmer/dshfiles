import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { AlertCircleIcon, SendIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'

import { agentLimits, type Agent } from './agent.js'
import { AgentName } from './agent-list.js'

export interface AgentStartProject {
  readonly id: string
  readonly title: string
}

/** Start a thread with one agent: the task, where it runs, and what the thread will carry from the agent. */
export const AgentStartDialog = (props: {
  readonly agent: Agent | null
  readonly projects: readonly AgentStartProject[]
  readonly routeLabel: (agent: Agent) => string
  readonly presetLabel: (agent: Agent) => string
  readonly pending: boolean
  readonly error: string | null
  readonly onOpenChange: (open: boolean) => void
  readonly onStart: (input: { readonly prompt: string; readonly target: string }) => void
}): JSX.Element => {
  const [prompt, setPrompt] = useState('')
  const [target, setTarget] = useState('default')
  const agent = props.agent
  const targetOptions: readonly ComboboxOption[] = [
    { value: 'default', label: 'Default project' },
    ...props.projects.map(project => ({ value: `project:${project.id}`, label: project.title })),
  ]
  const start = (): void => {
    if (props.pending) return
    props.onStart({ prompt, target })
  }

  return (
    <Dialog
      open={agent !== null}
      onOpenChange={open => {
        if (!open) setPrompt('')
        props.onOpenChange(open)
      }}
    >
      <DialogContent className="dshx-root dshx:sm:max-w-lg">
        {agent === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>Start a thread with @{agent.handle}</DialogTitle>
              <DialogDescription>
                <AgentName glyph={agent.glyph} name={agent.name} /> · {props.routeLabel(agent)} · {props.presetLabel(agent)}
                {agent.instructions.trim() === '' ? '' : ' · its instructions open the thread'}
              </DialogDescription>
            </DialogHeader>
            {agent.enabled ? null : (
              <p className="dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
                @{agent.handle} is off, so mentions ignore it. You can still start a thread here, or turn it on in its row.
              </p>
            )}
            <form
              className="dshx:flex dshx:flex-col dshx:gap-3"
              onSubmit={event => {
                event.preventDefault()
                start()
              }}
            >
              <Textarea
                aria-label="Prompt"
                autoFocus
                rows={4}
                maxLength={agentLimits.message}
                value={prompt}
                placeholder={`What should @${agent.handle} do? Leave empty to have it look around and wait.`}
                className="dshx:min-h-28"
                onChange={event => setPrompt(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    start()
                  }
                }}
              />
              <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
                <span aria-hidden className="dshx:text-xs dshx:font-medium">
                  Project
                </span>
                <Combobox
                  label="Project"
                  matchTriggerWidth
                  value={target}
                  options={targetOptions}
                  searchAbove={0}
                  searchPlaceholder="Search projects…"
                  onValueChange={setTarget}
                />
              </div>
              {props.error === null ? null : (
                <p role="alert" className="dshx:flex dshx:items-start dshx:gap-1.5 dshx:text-xs dshx:text-destructive">
                  <AlertCircleIcon aria-hidden className="dshx:mt-0.5 dshx:size-3.5 dshx:shrink-0" />
                  <span>{props.error} Check the project and try again, or pick “Default project”.</span>
                </p>
              )}
              <DialogFooter className="dshx:gap-2">
                <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={props.pending}>
                  <SendIcon />
                  {props.pending ? 'Starting…' : 'Start thread'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
