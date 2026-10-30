export const BACKLOG_PANEL_ID = 'dshfiles-backlog-panel'

export const panelDraftKey = (panelId: string | undefined): string => (panelId === undefined || panelId === BACKLOG_PANEL_ID ? 'feed' : `panel/${panelId}`)
