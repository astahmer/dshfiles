/** Ordered Chat rows, local echoes, and running status share the flow slot's parent. */
import { Fragment, memo, useContext, useMemo } from 'react'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ChatFlowSlotProps } from '../contract/slots.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ChatGroupSeat } from './ChatGroupSeat.tsx'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { chatRenderKey } from './render-entry.ts'
import { RunningStatus } from './RunningStatus.tsx'
import { RunFoldContext, useRunFoldPlacements, type RunFoldScope } from './RunFold.tsx'
import { SinceYouLeftContext } from './SinceYouLeftCard.tsx'

/** Render the flow without adding a DOM parent or changing keyed row positions. */
export const ChatFlow = memo(function ChatFlow({
  entries, pendingInputs, lastInputTurn, deferCollapse,
  useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation,
  useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, inspectCall, forkAt, loadImage, useProjection, fileMentions,
  sessionId, useSessions, useSessionStatus,
}: ChatFlowSlotProps) {
  const nodeStore = useChat(snapshot => snapshot.nodes)
  // dshfiles (b:7rv2): runs of background jobs and subagents fold in every mode but Verbose.
  const foldRuns = usePresentation(policy => policy.mode !== 'verbose')
  const runFoldScope = useMemo<RunFoldScope>(() => ({
    sessionId, enabled: foldRuns, runtime: { useSessions, useSessionStatus },
  }), [sessionId, foldRuns, useSessions, useSessionStatus])
  return (
    <RunFoldContext.Provider value={runFoldScope}>
      <ChatFlowRows {...{
        entries, pendingInputs, lastInputTurn, deferCollapse, nodeStore,
        useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation,
        useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
        cwd, openFile, inspectCall, forkAt, loadImage, useProjection, fileMentions,
      }} />
    </RunFoldContext.Provider>
  )
})

type ChatFlowRowsProps = Pick<ChatFlowSlotProps,
  'entries' | 'pendingInputs' | 'lastInputTurn' | 'deferCollapse'
  | 'useSession' | 'useChat' | 'useChatNode' | 'useChatNodeBottom' | 'useChatNodeProcess' | 'useChatGroup' | 'usePresentation'
  | 'useStore' | 'actions' | 'renderSlot' | 'renderFactorySlot' | 't' | 'useGroupAction' | 'useGroupHeaderAction'
  | 'cwd' | 'openFile' | 'inspectCall' | 'forkAt' | 'loadImage' | 'useProjection' | 'fileMentions'>
  & { readonly nodeStore: ChatNodeStore }

const ChatFlowRows = memo(function ChatFlowRows({
  entries, pendingInputs, lastInputTurn, deferCollapse, nodeStore,
  useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation,
  useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, inspectCall, forkAt, loadImage, useProjection, fileMentions,
}: ChatFlowRowsProps) {
  const runKeys = useMemo(() => entries.map(entry => entry.kind === 'node' && entry.groupPart === undefined ? entry.key : undefined), [entries])
  const placements = useRunFoldPlacements(nodeStore, runKeys)
  // dshfiles (productivity pass T4.3): the "Since you left" divider, keyed so inserting it moves no other row.
  const sinceYouLeft = useContext(SinceYouLeftContext)
  const running = useSession(snapshot => snapshot.running)
  const latestTurnAnchor = useChat(snapshot => snapshot.navigation.items().at(-1)?.anchorKey)
  const runningStartTime = useChatNode(latestTurnAnchor ?? '', (node) => {
    const location = node?.location
    return location?.kind === 'turn' || location?.kind === 'step'
      ? location.turn.status === 'open' ? location.turn.start?.time : undefined
      : undefined
  })
  const seatProps = {
    nodeStore, useChatNode, useChatNodeBottom, useChatNodeProcess, usePresentation,
    useStore, actions, renderSlot, t, useGroupAction, deferCollapse,
    cwd, openFile, inspectCall, forkAt, loadImage, useProjection, fileMentions,
  }
  const rows = entries.map((entry, index) => {
    switch (entry.kind) {
      case 'node':
        return <ChatNodeSeat {...seatProps} key={chatRenderKey(entry)} nodeKey={entry.key}
          runFold={placements[index]}
          {...entry.groupPart === undefined ? {} : { groupPart: entry.groupPart }} />
      case 'group':
        return <ChatGroupSeat {...seatProps} key={chatRenderKey(entry)} groupKey={entry.key}
          useChatGroup={useChatGroup} useGroupHeaderAction={useGroupHeaderAction} />
      default:
        return assertNever(entry)
    }
  })
  // At the unread landing the answer row draws it (ChatNodeSeat); otherwise it goes above the first unseen Turn.
  if (sinceYouLeft !== null && sinceYouLeft.answerTurn === undefined) {
    const index = entries.findIndex(entry => chatRenderKey(entry) === sinceYouLeft.beforeKey)
    if (index !== -1) rows.splice(index, 0, <Fragment key="dshfiles-since-you-left">{sinceYouLeft.element}</Fragment>)
  }
  const pendingRows = pendingInputs.map(item => 'requestId' in item ? (
    <PendingSubmissionBubble key={item.requestId} submission={item}
      loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
  ) : (
    <PendingSteeringBubble key={item.id} content={item.content}
      loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
  ))
  const tail = entries.at(-1)
  const node = tail?.kind === 'node' ? nodeStore.get(tail.key) : undefined
  // An empty opening control follows one local transcript echo, never steering.
  // All rows share this keyed list so inserting the control keeps the echo mounted.
  if (node?.kind === 'turn-process' && node.location.kind === 'turn'
    && node.location.turn.status === 'open' && node.location.turn.turn !== lastInputTurn) {
    const index = pendingInputs.findIndex(item => 'requestId' in item && item.placement === 'transcript')
    if (index !== -1) rows.splice(rows.length - 1, 0, ...pendingRows.splice(index, 1))
  }
  return [...rows, ...pendingRows, ...running ? [<RunningStatus key="running" startTime={runningStartTime} t={t} />] : []]
})
