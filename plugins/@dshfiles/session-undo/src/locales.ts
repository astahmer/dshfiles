import { defineLocale } from '@dshfiles/dshx/client'

const SESSION_UNDO_LOCALE_NAMESPACE = 'dshfiles.sessionUndo'

const en = {
  undo: 'Undo last turn',
  undoTurn: 'Undo “{prompt}”: restore the files and continue before it',
  undoTurnNoFiles: 'Undo “{prompt}” (no file snapshot): continue before it',
  redo: 'Redo the undone turn and its files',
  untitledTurn: 'last turn',
  failed: 'Could not {verb}: {message}',
}

const zh = {
  undo: '撤销上一轮',
  undoTurn: '撤销“{prompt}”：恢复文件并从其之前继续',
  undoTurnNoFiles: '撤销“{prompt}”（无文件快照）：从其之前继续',
  redo: '重做被撤销的一轮及其文件',
  untitledTurn: '上一轮',
  failed: '无法{verb}：{message}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.sessionUndo': keyof typeof en
  }
}

export const sessionUndoLocale = defineLocale(SESSION_UNDO_LOCALE_NAMESPACE, { en, zh })
export const SESSION_UNDO_LOCALE = SESSION_UNDO_LOCALE_NAMESPACE
