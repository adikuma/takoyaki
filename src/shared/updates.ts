export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadPercent: number | null
  detail: string | null
  checkedAt: number | null
  downloadedAt: number | null
}

// keep update state serializable so it can move safely over ipc
export function createDefaultUpdateState(currentVersion: string, enabled: boolean): UpdateState {
  return {
    status: enabled ? 'idle' : 'disabled',
    currentVersion,
    availableVersion: null,
    downloadPercent: null,
    detail: enabled ? null : 'Updates are available only in the packaged app.',
    checkedAt: null,
    downloadedAt: null,
  }
}
