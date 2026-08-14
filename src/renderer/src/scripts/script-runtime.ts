import type { SavedScript, ScriptContext, ScriptMessageType, ScriptRunResult } from './script-types'

type Pending = {
  resolve: (value: ScriptRunResult) => void
  reject: (reason: Error) => void
  timer: number
}

export class ScriptRuntime {
  private worker: Worker | null = null
  private requestId = 0
  private pending = new Map<number, Pending>()

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./workers/runtime.worker.ts', import.meta.url), {
      type: 'module'
    })
    this.worker.onmessage = (
      event: MessageEvent<{ requestId: number; result?: ScriptRunResult; error?: string }>
    ) => {
      const pending = this.pending.get(event.data.requestId)
      if (!pending) return
      this.pending.delete(event.data.requestId)
      window.clearTimeout(pending.timer)
      if (event.data.error) pending.reject(new Error(event.data.error))
      else pending.resolve(event.data.result ?? null)
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || '脚本运行 Worker 异常')
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
      this.worker?.terminate()
      this.worker = null
    }
    return this.worker
  }

  run(
    script: SavedScript,
    value: unknown,
    msgType: ScriptMessageType,
    index: number,
    context: ScriptContext,
    timeoutMs = 50
  ): Promise<ScriptRunResult> {
    if (!script.compiledCode) return Promise.reject(new Error(`脚本“${script.name}”尚未编译`))
    const worker = this.ensureWorker()
    const requestId = ++this.requestId
    return new Promise<ScriptRunResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId)
        this.restart()
        reject(new Error(`脚本“${script.name}”执行超过 ${timeoutMs}ms，已终止脚本运行器`))
      }, timeoutMs + 250)
      this.pending.set(requestId, { resolve, reject, timer })
      worker.postMessage({
        type: 'run',
        requestId,
        scriptId: script.id,
        sourceHash: script.sourceHash || script.compiledCode,
        code: script.compiledCode,
        value,
        msgType,
        index,
        context,
        timeoutMs
      })
    })
  }

  disposeScript(scriptId: string): void {
    this.worker?.postMessage({ type: 'dispose', scriptId })
  }

  restart(): void {
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('脚本运行器已重启'))
    }
    this.pending.clear()
  }
}

export const scriptRuntime = new ScriptRuntime()
