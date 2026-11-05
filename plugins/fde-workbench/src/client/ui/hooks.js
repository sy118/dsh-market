/** React binding for the external workbench store. */
import { useSyncExternalStore } from 'react'

/** Subscribe a component to the store snapshot. */
export function useWorkbench(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
