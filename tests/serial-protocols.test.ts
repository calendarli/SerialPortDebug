import type { Rule } from '../src/renderer/src/types'
import assert from 'node:assert/strict'
import { test, beforeEach, afterEach, jest } from 'bun:test'
import { SerialFramer, defaultSerialFraming } from '../src/renderer/src/serial-framer'
import { appendCrc } from '../src/renderer/src/serial-utils'
import { ModbusClient } from '../src/renderer/src/modbus-client'
import {
  appendHexHistory,
  findReplyMatch,
  replyByteOffset
} from '../src/renderer/src/reply-matcher'
import { settlingTime } from '../src/renderer/src/settling-time'
import { saveReplyGroup, removeReplyGroup } from '../src/renderer/src/auto-reply-groups'
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
beforeEach(() =>
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
)
afterEach(() => {
  jest.useRealTimers()
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})
const packet = (values) => appendCrc(Uint8Array.from(values), 'modbus')
const read = packet([1, 3, 0, 0, 0, 2])
const response = packet([1, 3, 4, 0, 12, 0, 34])

test('hex pause history preserves byte boundaries and cross-chunk matches without tokenizing', () => {
  let history = ''
  const expected: string[] = []
  for (let index = 0; index < 12000; index++) {
    const hex = (index % 256).toString(16).padStart(2, '0').toUpperCase()
    history = appendHexHistory(history, hex)
    expected.push(hex)
  }
  assert.equal(history, expected.slice(-8192).join(' '))
  assert.equal(appendHexHistory(history, ''), history)
  assert.equal(appendHexHistory('AA BB', 'CC DD'), 'AA BB CC DD')
  const large = Array.from({ length: 20000 }, (_, i) => (i % 2 ? 'AB' : 'CD')).join(' ')
  assert.equal(appendHexHistory(history, large), large.split(' ').slice(-8192).join(' '))
})

test('single-byte missing header discards noise; multi-byte markers span chunks', () => {
  const framer = new SerialFramer(),
    frames: number[][] = []
  const emit = (bytes) => frames.push([...bytes])
  const config = { ...defaultSerialFraming, mode: 'header-footer' as const }
  for (let i = 0; i < 40; i++) framer.push('p', config, new Uint8Array(65536), emit)
  assert.equal(framer['states'].get('p')!.bytes.length, 0)
  const multi = { ...config, header: 'AABB', footer: 'CCDD' }
  for (const bytes of [
    [0, 170],
    [187, 1, 204],
    [221, 7, 170],
    [187, 2, 204, 221]
  ])
    framer.push('p', multi, Uint8Array.from(bytes), emit)
  assert.deepEqual(frames, [
    [170, 187, 1, 204, 221],
    [170, 187, 2, 204, 221]
  ])
})

test('mode changes and explicit disconnect clear partial frames and idle timers', () => {
  jest.useFakeTimers()
  const framer = new SerialFramer(),
    frames: number[][] = []
  const emit = (b) => frames.push([...b])
  const fixed = { ...defaultSerialFraming, mode: 'fixed' as const, fixedLength: 2 }
  framer.push('p', fixed, Uint8Array.of(1), emit)
  framer.push('p', defaultSerialFraming, Uint8Array.of(2), emit)
  framer.push('p', fixed, Uint8Array.of(3), emit)
  framer.clear('p')
  framer.push('p', fixed, Uint8Array.of(4, 5), emit)
  framer.push('p', { ...fixed, mode: 'idle' }, Uint8Array.of(6), emit)
  framer.push('p', defaultSerialFraming, Uint8Array.of(7), emit)
  jest.advanceTimersByTime(100)
  assert.deepEqual(frames, [[2], [4, 5], [7]])
})

test('large fixed chunks and split delimiters preserve every byte', () => {
  const framer = new SerialFramer(),
    input = Uint8Array.from({ length: 262144 }, (_, i) => i % 251)
  let offset = 0
  framer.push('p', { ...defaultSerialFraming, mode: 'fixed', fixedLength: 8 }, input, (b) => {
    assert.deepEqual(b, input.slice(offset, offset + 8))
    offset += 8
  })
  assert.equal(offset, input.length)
  const frames: string[] = [],
    config = { ...defaultSerialFraming, mode: 'delimiter' as const, delimiter: '\\r\\n' }
  for (const s of ['one\r', '\ntwo\r\nthree', '\r\n'])
    framer.push('q', config, new TextEncoder().encode(s), (b) =>
      frames.push(new TextDecoder().decode(b))
    )
  assert.deepEqual(frames, ['one\r\n', 'two\r\n', 'three\r\n'])
})

test('Modbus accepts every possible split, ignores corrupt and unrelated frames', async () => {
  for (let split = 0; split <= response.length; split++) {
    const client = new ModbusClient()
    const result = client.request(read, async () => true)
    client.push(packet([2, 3, 4, 0, 0, 0, 0]))
    const corrupt = response.slice()
    corrupt[3] ^= 1
    client.push(corrupt)
    client.push(response.slice(0, split))
    client.push(response.slice(split))
    assert.deepEqual(await result, response)
    assert.equal(client.busy, false)
  }
})

test('Modbus requires matching write confirmation and validates exception CRC', async () => {
  const client = new ModbusClient(),
    write = packet([1, 6, 0, 4, 0, 9])
  const result = client.request(write, async () => true)
  client.push(packet([1, 6, 0, 5, 0, 9]))
  assert.equal(client.busy, true)
  client.push(write)
  assert.deepEqual(await result, write)
  const failure = client.request(read, async () => true)
  const check = assert.rejects(failure, /Modbus exception 2/)
  const exception = packet([1, 131, 2]),
    corrupt = exception.slice()
  corrupt[4] ^= 1
  client.push(corrupt)
  assert.equal(client.busy, true)
  client.push(exception)
  await check
})

test('Modbus rejects overlap, releases on timeout, disconnect and transport failure', async () => {
  jest.useFakeTimers()
  const client = new ModbusClient()
  const first = client.request(read, async () => true, 100)
  const timeout = assert.rejects(first, /timeout/)
  await assert.rejects(
    client.request(read, async () => true),
    /pending/
  )
  jest.advanceTimersByTime(100)
  await timeout
  const second = client.request(read, async () => true)
  const cancelled = assert.rejects(second, /disconnected/)
  client.cancel('disconnected')
  await cancelled
  await assert.rejects(
    client.request(read, async () => false),
    /send failed/
  )
  assert.equal(client.busy, false)
})

test('automatic reply consumes repeated lines while retaining an incomplete suffix', () => {
  let input = 'PING\r\nPING\r\nPI',
    count = 0
  while (true) {
    const result = findReplyMatch(/^PING$/m, input, true)
    if (!result) break
    count++
    input = input.slice(result.end)
  }
  assert.equal(count, 2)
  assert.equal(input, 'PI')
  assert.ok(findReplyMatch(/^PING$/m, input + 'NG', true))
  assert.equal(findReplyMatch(/^/m, input, true), null)
  assert.equal(findReplyMatch(/AA BB/, '00 AA BB CC', false)!.end, 8)
})

test('linear settling time agrees with the original definition across response shapes', () => {
  for (let mask = 0; mask < 256; mask++) {
    const points = Array.from({ length: 8 }, (_, i) => ({
      timestamp: i * 10,
      value: (mask >> i) & 1
    }))
    for (let start = -1; start < 8; start++) {
      let expected: number | null = null
      if (start >= 0)
        for (let i = start; i < points.length; i++) {
          if (points.slice(i).every((p) => Math.abs(p.value) <= 0.1)) {
            expected = points[i].timestamp - points[start].timestamp
            break
          }
        }
      assert.equal(settlingTime(points, start, 0, 0.1), expected)
    }
  }
})

test('reply consumption preserves split UTF-8 and uses original bytes for HEX replies', () => {
  const bytes = Uint8Array.of(0xe4, 0xbd, 0xa0, 0x0a, 0xe5)
  const input = new TextDecoder().decode(bytes, { stream: true })
  const selected = findReplyMatch(/.+/m, input, true)
  assert.equal(replyByteOffset(bytes, selected!.end, false), 4)
  assert.deepEqual(bytes.slice(replyByteOffset(bytes, selected!.end, false)), Uint8Array.of(0xe5))
  assert.equal(replyByteOffset(bytes, 8, true), 3)
  assert.equal(replyByteOffset(bytes, 0, false), 0)
})

test('cancellation before transport starts does not send an obsolete request', async () => {
  const client = new ModbusClient()
  let sends = 0
  const result = client.request(read, async () => {
    sends++
    return true
  })
  const rejected = assert.rejects(result, /connection changed/)
  client.cancel()
  await rejected
  assert.equal(sends, 0)
})

test('Modbus multiple-register writes check echoed address and quantity', async () => {
  const client = new ModbusClient()
  const write = packet([1, 16, 0, 4, 0, 2, 4, 0, 1, 0, 2])
  const result = client.request(write, async () => true)
  const wrong = packet([1, 16, 0, 4, 0, 1])
  const right = packet([1, 16, 0, 4, 0, 2])
  client.push(Uint8Array.from([...wrong, ...right]))
  assert.deepEqual(await result, right)
})

test('reply groups support add and rename without losing live shared variables', () => {
  const original = [{ id: 1, name: 'Default', globals: { count: 7 } }]
  const created = saveReplyGroup(original, null, '  Motor  ')
  assert.equal(created.length, 2)
  assert.equal(created[1].name, 'Motor')
  assert.notEqual(created[1].id, 1)
  const renamed = saveReplyGroup(created, 1, 'State')
  assert.equal(renamed[0].id, 1)
  assert.equal(renamed[0].globals, original[0].globals)
  assert.equal(original[0].name, 'Default')
  assert.throws(() => saveReplyGroup(created, null, '  '))
  assert.throws(() => saveReplyGroup(created, 1, 'Motor'))
  assert.throws(() => saveReplyGroup(created, 999, 'Missing'))
})

test('deleting reply groups preserves rules and destination state while pausing migrated rules', () => {
  const groups = [
    { id: 1, name: 'A', globals: { count: 1 } },
    { id: 2, name: 'B', globals: { count: 9 } }
  ]
  const rules: Rule[] = [
    {
      name: 'A',
      reply: '',
      hex: false,
      parameters: [],
      id: 10,
      groupId: 1,
      enabled: true,
      pattern: 'PING',
      parameterProgram: 'code'
    },
    {
      name: 'B',
      pattern: '',
      reply: '',
      hex: false,
      parameters: [],
      id: 11,
      groupId: 2,
      enabled: true
    }
  ]
  const result = removeReplyGroup(groups, rules, 1, 2)
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0], groups[1])
  assert.equal(result.rules.length, 2)
  assert.equal(result.rules[0].groupId, 2)
  assert.equal(result.rules[0].enabled, false)
  assert.equal(result.rules[0].pattern, 'PING')
  assert.equal(result.rules[0].parameterProgram, 'code')
  assert.equal(result.rules[1], rules[1])
  assert.equal(result.movedIds.join(','), '10')
  assert.equal(rules[0].enabled, true)
  assert.throws(() => removeReplyGroup([groups[0]], rules, 1, 2))
  assert.throws(() => removeReplyGroup(groups, rules, 1, 1))
  assert.throws(() => removeReplyGroup(groups, rules, 1, 999))
  assert.throws(() => removeReplyGroup(groups, rules, 999, 2))
})
