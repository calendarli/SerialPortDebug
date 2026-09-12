import { useState } from 'react'
import { updateAction, updateButtonLabel, type UpdateState } from '@common/update'

type Props = { state: UpdateState; onAction: () => Promise<void> }

function megabytes(bytes = 0): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function UpdateControls({ state, onAction }: Props): React.JSX.Element {
  return (
    <div className="update-controls">
      <p role="status">{state.message}</p>
      {state.status === 'downloading' && (
        <div className="update-progress">
          <progress aria-label="更新下载进度" max={100} value={state.percent ?? 0} />
          <span>
            {(state.percent ?? 0).toFixed(1)}% · {megabytes(state.transferred)} /{' '}
            {state.total ? megabytes(state.total) : '计算中…'} · {megabytes(state.bytesPerSecond)}/s
          </span>
        </div>
      )}
      <button type="button" disabled={!updateAction(state)} onClick={() => void onAction()}>
        {updateButtonLabel(state)}
      </button>
    </div>
  )
}

export function UpdateNotice({ state, onAction }: Props): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState('')
  const key = `${state.status}:${state.version ?? ''}:${state.retry ?? ''}`
  if (
    !['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.status) ||
    dismissed === key
  )
    return null
  return (
    <aside className="update-notice" aria-label="软件更新">
      <strong>{state.status === 'downloaded' ? '更新已下载完成' : '软件更新'}</strong>
      <button
        type="button"
        className="update-notice-close"
        aria-label="收起更新提示"
        title="稍后可在关于中继续更新"
        onClick={() => setDismissed(key)}
      >
        ×
      </button>
      <UpdateControls state={state} onAction={onAction} />
    </aside>
  )
}
