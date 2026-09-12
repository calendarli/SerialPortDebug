import { useCallback, useEffect, useState } from 'react'
import { updateAction, type UpdateState } from '@common/update'

export function useAppUpdates(): { state: UpdateState; runAction: () => Promise<void> } {
  const [state, setState] = useState<UpdateState>({ status: 'idle', message: '正在读取更新状态…' })
  useEffect(() => {
    let active = true
    let received = false
    const off = window.api.onUpdateState((next) => {
      received = true
      if (active) setState(next)
    })
    void window.api
      .getUpdateState()
      .then((next) => {
        if (active && !received) setState(next)
      })
      .catch((error: unknown) => {
        if (active && !received)
          setState({
            status: 'error',
            retry: 'check',
            message: `读取更新状态失败：${String(error)}`
          })
      })
    return () => {
      active = false
      off()
    }
  }, [])
  const runAction = useCallback(async () => {
    const action = updateAction(state)
    try {
      if (action === 'check') await window.api.checkForUpdates()
      if (action === 'download') await window.api.downloadUpdate()
      if (action === 'install') await window.api.installUpdate()
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: 'error',
        retry: action ?? 'check',
        message: `更新操作失败：${String(error)}`
      }))
    }
  }, [state])
  return { state, runAction }
}
