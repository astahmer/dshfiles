// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { SubagentProvenanceToolRow } from './subagent-tool-row.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  DisclosureRow: ({ title, collapsedContent, open, children }: { title: string; collapsedContent?: ReactNode; open: boolean; children?: ReactNode }) => (
    <div>
      <div>{title}</div>
      {collapsedContent === undefined ? null : <div data-testid="collapsed-content">{collapsedContent}</div>}
      {open ? <div data-testid="expanded-content">{children}</div> : null}
    </div>
  ),
  IconAgentPresetOutlineRegular: () => null,
  IconInspectOutlineRegular: () => null,
}))

type Props = Parameters<typeof SubagentProvenanceToolRow>[0]

const unused = (): never => {
  throw new Error('Unused in the tool row fixture')
}

const translate: Props['t'] = key => {
  if (key === 'tool.title.subagent') return 'Create subagent'
  if (key === 'row.inspect') return 'Inspect'
  return key
}

const props = ({
  provider,
  model,
  prompt = 'Review this change',
  expanded = false,
}: {
  provider: string
  model: string
  prompt?: string
  expanded?: boolean
}): Props => ({
  phase: 'start',
  // SAFETY: fixture id only needs SessionId's brand; no Host validates it.
  sessionId: 'session-1' as SessionId,
  block: {
    phase: 'start',
    callId: 'call-1',
    name: 'subagent',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: [],
    argsRaw: JSON.stringify({ prompt, provider, model }),
    args: PartialArguments.fromText(JSON.stringify({ prompt, provider, model })),
  },
  callId: 'call-1',
  toolName: 'subagent',
  cwd: '/workspace',
  home: '/home/test',
  openFile: unused,
  loadImage: unused,
  useDisclosure: () => ({ expanded, setExpanded: unused, toggle: unused }),
  useAccess: unused,
  useRemoteAccess: unused,
  useSessionAccess: unused,
  useWorkspaceAccess: unused,
  useWorkspaces: unused,
  usePanelInfo: unused,
  useResource: unused,
  useSessions: unused,
  useSessionStatus: unused,
  useSessionRetainInfo: unused,
  useChat: unused,
  useConversation: unused,
  useInput: unused,
  inputActions: {
    captureInsertion: unused,
    insertText: unused,
    setDraft: unused,
    persistDraft: unused,
    addAttachments: unused,
    removeAttachment: unused,
    pruneAttachments: unused,
    submit: unused,
  },
  useSession: unused,
  useProjection: unused,
  t: translate,
})

afterEach(cleanup)

describe('SubagentProvenanceToolRow', () => {
  it('shows a readable subagent name and the requested provider/model', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna' })} />)
    expect(screen.getByText(/^Create subagent · [A-Z][a-z]+ [A-Z][a-z]+ · openai\/gpt-6\.1-luna$/)).not.toBeNull()
  })

  it('keeps the full prompt out of the collapsed preview', () => {
    const prompt = 'Review this change, inspect every related test, and report any regressions.'
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', prompt })} />)
    expect(screen.queryByTestId('collapsed-content')).toBeNull()
    expect(screen.queryByText(prompt)).toBeNull()
  })

  it('shows the full prompt when the row is expanded', () => {
    const prompt = 'Review this change, inspect every related test, and report any regressions.'
    render(<SubagentProvenanceToolRow {...props({ provider: 'openai', model: 'gpt-6.1-luna', prompt, expanded: true })} />)
    expect(screen.getByTestId('expanded-content').textContent).toContain(prompt)
  })

  it('omits email-like route values from the visible tool card', () => {
    render(<SubagentProvenanceToolRow {...props({ provider: 'alex@example.com', model: 'gpt-6.1-luna' })} />)
    expect(screen.getByText(/^Create subagent · [A-Z][a-z]+ [A-Z][a-z]+$/)).not.toBeNull()
    expect(screen.queryByText(/alex@example\.com/)).toBeNull()
  })
})
