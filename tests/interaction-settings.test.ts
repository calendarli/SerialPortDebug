import assert from 'node:assert/strict'
import { test, afterEach } from 'bun:test'
import {
  InteractionTextDecoder,
  normalizeInteractionDisplay,
  loadInteractionDisplay,
  interactionDisplayKey
} from '../src/renderer/src/interaction-settings'
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})
test('interaction-settings regression coverage', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values)
  const utf8 = new TextEncoder().encode('中文')
  for (let split = 0; split <= utf8.length; split++) {
    const decoder = new InteractionTextDecoder()
    assert.equal(
      decoder.decode('COM1', utf8.slice(0, split), 'utf-8') +
        decoder.decode('COM1', utf8.slice(split), 'utf-8'),
      '中文'
    )
  }
  const gbk = bytes(0xd6, 0xd0, 0xce, 0xc4)
  for (const encoding of ['gbk', 'gb18030'] as const) {
    for (let split = 0; split <= gbk.length; split++) {
      const decoder = new InteractionTextDecoder()
      assert.equal(
        decoder.decode('COM1', gbk.slice(0, split), encoding) +
          decoder.decode('COM1', gbk.slice(split), encoding),
        '中文'
      )
    }
  }
  const decoder = new InteractionTextDecoder()
  assert.equal(decoder.decode('COM1', utf8.slice(0, 1), 'utf-8'), '')
  assert.equal(decoder.decode('COM2', gbk, 'gbk'), '中文')
  assert.equal(decoder.decode('COM1', utf8.slice(1), 'utf-8'), '中文')
  decoder.decode('COM1', bytes(0xd6), 'gbk')
  assert.equal(decoder.decode('COM1', bytes(65), 'utf-8'), 'A')
  decoder.decode('COM1', bytes(0xd6), 'gbk')
  decoder.clear('COM1')
  assert.equal(decoder.decode('COM1', gbk, 'gbk'), '中文')
  assert.equal(decoder.decode('COM3', bytes(0x2d, 0x4e), 'utf-16le'), '中')
  assert.equal(decoder.decode('COM4', bytes(0x4e, 0x2d), 'utf-16be'), '中')
  assert.equal(decoder.decode('COM5', bytes(0xa4, 0xa4), 'big5'), '中')
  const defaults = normalizeInteractionDisplay(null)
  assert.equal(defaults.encoding, 'utf-8')
  assert.deepEqual(
    normalizeInteractionDisplay({ encoding: 'invalid', rx: { color: 'bad', font: '', size: 999 } }),
    defaults
  )
  const configured = normalizeInteractionDisplay({
    encoding: 'gbk',
    rx: { color: '#123456', font: 'Microsoft YaHei', size: 18 },
    tx: { color: '#654321', font: 'Consolas', size: 12 }
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) {
        assert.equal(key, interactionDisplayKey)
        return JSON.stringify(configured)
      }
    }
  })
  assert.deepEqual(loadInteractionDisplay(), configured)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        return '{invalid'
      }
    }
  })
  assert.deepEqual(loadInteractionDisplay(), defaults)
  console.log(
    'Display settings: encoding splits, port isolation, encoding changes, disconnect reset, validation and persistence passed.'
  )
})
