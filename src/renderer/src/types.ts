import type { ConnectionProfile, SessionStatus, TunnelRuntime, TransferDirection } from '@shared/types'

export interface SessionTab {
  id: string
  profile: ConnectionProfile
  status: SessionStatus
  message?: string
  tunnels: TunnelRuntime[]
  isAttached?: boolean
}

export interface FileTransfer {
  transferId: string
  sessionId: string
  direction: TransferDirection
  fileName: string
  remotePath: string
  bytesTransferred: number
  totalBytes: number
  done: boolean
  error?: string
}

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: string
  kind: ToastKind
  title: string
  description?: string
}