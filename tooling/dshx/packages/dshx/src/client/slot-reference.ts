import { CLIENT_SLOT_REFERENCES } from 'create-dshx/slot-capabilities'

/** Look up one slot, or `undefined` when the name is not in the verified catalog. */
export const findClientSlot = (name: string) => CLIENT_SLOT_REFERENCES.find(slot => slot.name === name)

/** Type-only imports a plugin needs before this slot name typechecks. */
export const slotOwnerImports = (name: string): readonly string[] => findClientSlot(name)?.declaredBy ?? []
