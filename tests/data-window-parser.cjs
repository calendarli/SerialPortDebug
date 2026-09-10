const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const filename = path.resolve(__dirname, '../src/renderer/src/data-window-parser.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const loaded = new Module(filename, module)
loaded._compile(compiled, filename)
const { compileDataPattern, DataWindowParser, dataHexToDecimal, formatDataValue } = loaded.exports
const bytes = (...values) => Uint8Array.from(values)
const frame = bytes(0xAA, 2, 1, 2, 3, 4, 0xBB)
// Every possible boundary in the example must produce exactly the same frame.
for (let split = 0; split <= frame.length; split++) {
  const parser = new DataWindowParser(compileDataPattern('AA 02 {数据:4} BB'))
  const first = parser.push(frame.slice(0, split))
  const last = parser.push(frame.slice(split))
  assert.equal(first.count + last.count, 1)
  assert.equal((last.latest || first.latest).fields[0].hex, '01 02 03 04')
}
const parser = new DataWindowParser(compileDataPattern('AA02{数据:4}BB'))
const combined = bytes(0, 0xAA, 2, 1, 2, 3, 4, 0, ...frame, ...frame)
const result = parser.push(combined)
assert.equal(result.count, 2) // Reject the bad tail and resynchronize past noise.
assert.equal(result.latest.frame, 'AA 02 01 02 03 04 BB')
const custom = new DataWindowParser(compileDataPattern('{前:1} 55 ?? {温度:2} 0D {后:1}'))
assert.deepEqual(custom.push(bytes(9, 0x55, 0xFF, 1, 2, 13, 8)).latest.fields,
  [{ name: '前', hex: '09' }, { name: '温度', hex: '01 02' }, { name: '后', hex: '08' }])
const a = new DataWindowParser(compileDataPattern('AA 02 {数据:4} BB'))
const b = new DataWindowParser(compileDataPattern('AA 02 {数据:4} BB'))
a.push(frame.slice(0, 3))
assert.equal(b.push(frame.slice(3)).count, 0) // Separate window buffers never mix.
a.clear()
assert.equal(a.push(frame.slice(3)).count, 0) // Disconnect discards a partial frame.
assert.equal(a.push(frame).count, 1)
for (const invalid of ['', 'AA BB', 'A {x:1}', 'GG {x:1}', '{x:0}', '{x:4097}', '{x:1} {x:2}', '{ :1}', '{x:1.5}', '{x:4096} AA'])
  assert.throws(() => compileDataPattern(invalid), undefined, invalid)
const bounded = new DataWindowParser(compileDataPattern('AA 02 {数据:4} BB'))
assert.equal(bounded.push(new Uint8Array(100000)).count, 0)
assert.ok(bounded.pending.length < frame.length)
assert.equal(bounded.push(frame).count, 1)
console.log('Data window parser: split frames, multiple frames, custom fields, invalid templates, isolation and bounded buffering passed.')

assert.equal(dataHexToDecimal('04 FD F3 6A'), '83751786')
assert.equal(dataHexToDecimal('00 00 00 00'), '0')
assert.equal(dataHexToDecimal('FF FF FF FF'), '4294967295')
assert.equal(dataHexToDecimal('FF FF FF FF FF FF FF FF'), '18446744073709551615')
console.log('DEC conversion: big-endian example, zero, unsigned 32-bit and precise 64-bit passed.')

assert.deepEqual(formatDataValue('FF FF FF FF', true, 1), { hex: '-01', dec: '-0.1' })
assert.equal(formatDataValue('80 00 00 00', true).dec, '-2147483648')
assert.equal(formatDataValue('7F FF FF FF', true).dec, '2147483647')
assert.equal(formatDataValue('FF', true).dec, '-1')
assert.equal(formatDataValue('FF', false, 1).dec, '25.5')
assert.equal(formatDataValue('00 00', true, 2).dec, '0.00')
assert.equal(formatDataValue('00 7B', true, 1).dec, '12.3')
assert.equal(formatDataValue('FF FF FF FF FF FF FF FF', false, 2).dec, '184467440737095516.15')
assert.equal(formatDataValue('FF 85', true, 2).dec, '-1.23')
const multiple = new DataWindowParser(compileDataPattern('AA 05 {数据:4} {状态:1}BB'))
const fields = multiple.push(bytes(0xAA, 5, 0xFF, 0xFF, 0xFF, 0x85, 2, 0xBB)).latest.fields
assert.deepEqual(fields, [{ name: '数据', hex: 'FF FF FF 85' }, { name: '状态', hex: '02' }])
assert.equal(formatDataValue(fields[0].hex, true, 1).dec, '-12.3')
assert.equal(formatDataValue(fields[1].hex, false, 0).dec, '2')
assert.throws(() => formatDataValue('01', false, -1))
assert.throws(() => formatDataValue('01', false, 1.5))
console.log('Signed HEX/DEC, exact decimal scaling and independent multi-field formats passed.')
