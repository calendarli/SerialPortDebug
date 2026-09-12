export type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
    | 'unsupported'
    | 'current'
  version?: string
  message: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  retry?: 'check' | 'download' | 'install'
}

export function updateAction(state: UpdateState): 'check' | 'download' | 'install' | null {
  if (state.status === 'available') return 'download'
  if (state.status === 'downloaded') return 'install'
  if (state.status === 'error') return state.retry ?? 'check'
  if (state.status === 'idle' || state.status === 'current') return 'check'
  return null
}

export function updateButtonLabel(state: UpdateState): string {
  const action = updateAction(state)
  if (action === 'install') return '安装更新'
  if (action === 'download') return state.status === 'error' ? '重试下载' : '下载更新'
  if (state.status === 'checking') return '正在检查…'
  if (state.status === 'downloading') return '正在下载…'
  if (state.status === 'installing') return '正在安装…'
  return '检查更新'
}
