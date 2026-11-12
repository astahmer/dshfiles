import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

const en = {
  title: 'Thread cleanup',
  description: 'Permanently delete the local logs of threads that are done or archived. Nothing runs automatically.',
  safety:
    'Threads loaded in this DSH are protected, even when idle. To include them, restart DSH yourself when your work is finished, then preview again without opening those threads.',
  scope: 'Only thread log generations are removed. Shared attachments, workspaces, backups and derived indexes remain. This is not secure erasure.',
  preview: 'Preview cleanup',
  preparing: 'Preparing preview…',
  delete: 'Delete previewed threads',
  deleting: 'Deleting…',
  confirmTitle: 'Permanently delete these threads?',
  confirmDescription:
    'Only the threads in this preview are processed. Changed or loaded threads are skipped. DSH cannot restore deleted logs. Export anything you need before continuing.',
  confirm: 'Permanently delete',
  cancel: 'Cancel',
  empty: 'No threads to clean up in this preview.',
  candidates: 'Threads to delete',
  protected: 'Protected: loaded, active work or migration required',
  remaining: 'More threads are eligible: preview again after this batch',
  archived: 'Archived',
  settled: 'Done',
  untitled: 'Untitled thread',
  results: 'Deletion results',
  deleted: 'Deleted',
  skipped: 'Skipped',
  failed: 'Failed',
  error: 'Cleanup is unavailable. Load the matching Host plugin, then retry the preview.',
} as const
const fr = {
  title: 'Nettoyage des fils',
  description: 'Supprimer définitivement les journaux locaux des fils terminés ou archivés. Aucun nettoyage automatique.',
  safety:
    'Les fils chargés dans ce DSH sont protégés, même inactifs. Pour les inclure, redémarrez DSH vous-même une fois votre travail terminé, puis prévisualisez sans ouvrir ces fils.',
  scope:
    'Seules les générations des journaux sont supprimées. Pièces jointes partagées, espaces de travail, sauvegardes et index dérivés restent. Ce n’est pas un effacement sécurisé.',
  preview: 'Prévisualiser le nettoyage',
  preparing: 'Préparation…',
  delete: 'Supprimer les fils prévisualisés',
  deleting: 'Suppression…',
  confirmTitle: 'Supprimer définitivement ces fils ?',
  confirmDescription:
    'Seuls les fils de cet aperçu seront traités. Fils modifiés ou chargés ignorés. DSH ne peut pas restaurer les journaux supprimés. Exportez ce que vous souhaitez conserver avant de continuer.',
  confirm: 'Supprimer définitivement',
  cancel: 'Annuler',
  empty: 'Aucun fil à nettoyer dans cet aperçu.',
  candidates: 'Fils à supprimer',
  protected: 'Protégés : chargés, travail actif ou migration nécessaire',
  remaining: 'D’autres fils sont éligibles : relancer après ce lot',
  archived: 'Archivé',
  settled: 'Terminé',
  untitled: 'Fil sans titre',
  results: 'Résultats de suppression',
  deleted: 'Supprimé',
  skipped: 'Ignoré',
  failed: 'Échec',
  error: 'Nettoyage indisponible. Chargez le plugin Host correspondant puis relancez l’aperçu.',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.conversation-cleanup': keyof typeof en
  }
}
export const cleanupLocale = defineLocale('dshfiles.conversation-cleanup', { en, fr })
export type CleanupTranslate = TranslateNS<'dshfiles.conversation-cleanup'>
