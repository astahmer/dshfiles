import { defineLocale } from '@dshfiles/dshx/client'

const SESSION_UNDO_LOCALE_NAMESPACE = 'dshfiles.sessionUndo'

const en = {
  undo: 'Undo last turn',
  undoTurn: 'Undo “{prompt}”: restore the files and continue before it',
  undoTurnNoFiles: 'Undo “{prompt}” (no file snapshot): continue before it',
  redo: 'Redo the undone turn and its files',
  untitledTurn: 'last turn',
  failed: 'Could not {verb}: {message}',
  rewind: 'Rewind to an earlier turn',
  rewindMenu: 'Rewind to before a turn',
  rewindHere: 'Rewind to here',
  turnLabel: 'Turn {turn}',
  untitledPrompt: '(no text)',
  confirmTitle: 'Rewind to before turn {turn}?',
  confirmLost: 'The thread continues in a fork cut before this turn. These {count} turns leave the conversation:',
  confirmFiles: 'Workspace files go back to how they were when turn {turn} started; edits made since are replaced.',
  confirmNoFiles: 'Turn {turn} has no file snapshot: only the conversation rewinds, files stay as they are.',
  checkpointFiles: 'files',
  confirmRedo: 'Redo brings the turns and their files back until the fork runs a new turn.',
  confirmAction: 'Rewind',
  cancel: 'Cancel',
  sharedTitle: 'Another thread works in this folder',
  anywayUndo: 'Undo anyway',
  anywayRewind: 'Rewind anyway',
  anywayRedo: 'Redo anyway',
}

const zh = {
  undo: '撤销上一轮',
  undoTurn: '撤销“{prompt}”：恢复文件并从其之前继续',
  undoTurnNoFiles: '撤销“{prompt}”（无文件快照）：从其之前继续',
  redo: '重做被撤销的一轮及其文件',
  untitledTurn: '上一轮',
  failed: '无法{verb}：{message}',
  rewind: '回退到更早的一轮',
  rewindMenu: '回退到某一轮之前',
  rewindHere: '回退到这里',
  turnLabel: '第 {turn} 轮',
  untitledPrompt: '（无文本）',
  confirmTitle: '回退到第 {turn} 轮之前？',
  confirmLost: '对话将在此轮之前分叉继续。以下 {count} 轮将离开对话：',
  confirmFiles: '工作区文件将恢复到第 {turn} 轮开始时的状态；之后的修改会被替换。',
  confirmNoFiles: '第 {turn} 轮没有文件快照：只回退对话，文件保持不变。',
  checkpointFiles: '含文件',
  confirmRedo: '在分叉运行新一轮之前，重做可以恢复这些轮次及其文件。',
  confirmAction: '回退',
  cancel: '取消',
  sharedTitle: '另一个线程正在此文件夹中工作',
  anywayUndo: '仍然撤销',
  anywayRewind: '仍然回退',
  anywayRedo: '仍然重做',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.sessionUndo': keyof typeof en
  }
}

export const sessionUndoLocale = defineLocale(SESSION_UNDO_LOCALE_NAMESPACE, { en, zh })
export const SESSION_UNDO_LOCALE = SESSION_UNDO_LOCALE_NAMESPACE
