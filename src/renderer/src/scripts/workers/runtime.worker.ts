/// <reference lib="webworker" />

import quickJsWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten'

type RunMessage = {
  type: 'run'
  requestId: number
  scriptId: string
  sourceHash: string
  code: string
  value: unknown
  msgType: 'send' | 'received'
  index: number
  context: Record<string, unknown>
  timeoutMs: number
}

type DisposeMessage = { type: 'dispose'; scriptId?: string }
type WorkerMessage = RunMessage | DisposeMessage

type ScriptVm = {
  sourceHash: string
  runtime: ReturnType<Awaited<ReturnType<typeof newQuickJSWASMModule>>['newRuntime']>
  context: ReturnType<
    ReturnType<Awaited<ReturnType<typeof newQuickJSWASMModule>>['newRuntime']>['newContext']
  >
  deadline: number
}

const scriptVms = new Map<string, ScriptVm>()
let quickJsPromise: ReturnType<typeof newQuickJSWASMModule> | null = null

function serialize(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array) return Array.from(item)
    return item
  })
  return (serialized === undefined ? 'null' : serialized).replace(/</g, '\\u003c')
}

function disposeVm(scriptId: string): void {
  const active = scriptVms.get(scriptId)
  if (!active) return
  scriptVms.delete(scriptId)
  active.context.dispose()
  active.runtime.dispose()
}

async function getScriptVm(message: RunMessage): Promise<ScriptVm> {
  const current = scriptVms.get(message.scriptId)
  if (current?.sourceHash === message.sourceHash) return current
  if (current) disposeVm(message.scriptId)
  quickJsPromise ||= newQuickJSWASMModule(
    newVariant(RELEASE_SYNC, { wasmLocation: quickJsWasmUrl })
  )
  const quickJs = await quickJsPromise
  const runtime = quickJs.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  const active: ScriptVm = {
    sourceHash: message.sourceHash,
    runtime,
    context: runtime.newContext(),
    deadline: Date.now() + Math.max(10, message.timeoutMs)
  }
  runtime.setInterruptHandler(() => Date.now() > active.deadline)
  const registration = active.context.evalCode(
    `'use strict';\nlet __serialflowHandler = null;\nfunction execute(handler) {\n  if (typeof handler !== 'function') throw new TypeError('execute 参数必须是函数');\n  __serialflowHandler = handler;\n}\n${message.code}\nif (typeof __serialflowHandler !== 'function') throw new Error('脚本必须调用 execute(handleSerial)');`,
    `${message.scriptId}.js`
  )
  if (registration.error) {
    const error = active.context.dump(registration.error)
    registration.error.dispose()
    active.context.dispose()
    active.runtime.dispose()
    throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
  }
  registration.value.dispose()
  scriptVms.set(message.scriptId, active)
  return active
}

async function runScript(message: RunMessage): Promise<unknown> {
  const active = await getScriptVm(message)
  active.deadline = Date.now() + Math.max(10, message.timeoutMs)
  const evaluation = active.context.evalCode(
    `__serialflowHandler(${serialize(message.value)}, ${serialize(message.msgType)}, ${message.index}, ${serialize(message.context)})`,
    `${message.scriptId}.run.js`
  )
  if (evaluation.error) {
    const error = active.context.dump(evaluation.error)
    evaluation.error.dispose()
    disposeVm(message.scriptId)
    throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
  }
  const result = active.context.dump(evaluation.value)
  evaluation.value.dispose()
  return result
}

self.onmessage = (event: MessageEvent<WorkerMessage>): void => {
  const message = event.data
  if (message.type === 'dispose') {
    if (message.scriptId) disposeVm(message.scriptId)
    else [...scriptVms.keys()].forEach(disposeVm)
    return
  }
  void runScript(message).then(
    (result) => self.postMessage({ requestId: message.requestId, result }),
    (cause) =>
      self.postMessage({
        requestId: message.requestId,
        error: cause instanceof Error ? cause.message : String(cause)
      })
  )
}
