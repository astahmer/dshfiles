import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

const en = {
  title: 'Conversation cleanup',
  description: 'Permanently delete local conversation logs that are settled or archived. Nothing runs automatically.',
  safety:
    'Loaded conversations are protected, even when idle. To include them, restart DSH yourself when your work is finished, then preview again without opening those conversations.',
  scope: 'Only conversation log generations are removed. Shared attachments, workspaces, backups and derived indexes remain. This is not secure erasure.',
  preview: 'Preview cleanup',
  preparing: 'Preparing preview…',
  delete: 'Delete previewed conversations',
  deleting: 'Deleting…',
  confirmTitle: 'Permanently delete these conversations?',
  confirmDescription:
    'Only the exact IDs in this preview will be processed. Changed or loaded conversations are skipped. Deleted logs cannot be restored by DSH. Export anything you need before continuing.',
  confirm: 'Permanently delete',
  cancel: 'Cancel',
  empty: 'No eligible conversations in this preview.',
  candidates: 'Conversations to delete',
  protected: 'Protected: loaded, active work or migration required',
  remaining: 'More eligible conversations: preview again after this batch',
  archived: 'Archived',
  settled: 'Settled',
  results: 'Deletion results',
  deleted: 'Deleted',
  skipped: 'Skipped',
  failed: 'Failed',
  error: 'Cleanup is unavailable. Load the matching Host plugin, then retry the preview.',
} as const
const fr = {
  title: 'Nettoyage des conversations',
  description: 'Supprimer définitivement les journaux locaux des conversations settled ou archivées. Aucun nettoyage automatique.',
  safety:
    'Conversations chargées protégées, même inactives. Pour les inclure, redémarrez DSH vous-même une fois votre travail terminé, puis prévisualisez sans ouvrir ces conversations.',
  scope:
    'Seules les générations des journaux sont supprimées. Pièces jointes partagées, espaces de travail, sauvegardes et index dérivés restent. Ce n’est pas un effacement sécurisé.',
  preview: 'Prévisualiser le nettoyage',
  preparing: 'Préparation…',
  delete: 'Supprimer les conversations prévisualisées',
  deleting: 'Suppression…',
  confirmTitle: 'Supprimer définitivement ces conversations ?',
  confirmDescription:
    'Seuls les identifiants de cet aperçu seront traités. Conversations modifiées ou chargées ignorées. DSH ne peut pas restaurer les journaux supprimés. Exportez ce que vous souhaitez conserver avant de continuer.',
  confirm: 'Supprimer définitivement',
  cancel: 'Annuler',
  empty: 'Aucune conversation éligible dans cet aperçu.',
  candidates: 'Conversations à supprimer',
  protected: 'Protégées : chargées, travail actif ou migration nécessaire',
  remaining: 'Autres conversations éligibles : relancer après ce lot',
  archived: 'Archivée',
  settled: 'Settled',
  results: 'Résultats de suppression',
  deleted: 'Supprimée',
  skipped: 'Ignorée',
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
