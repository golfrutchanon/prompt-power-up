import { expect, test } from 'claude-code/testing'

const LONG = 'เอ่อ คือว่าอยากให้ช่วยทำ usage bar แบบว่า ที่มันโชว์ token อะ ไม่ใช่ๆ เอาเป็น progress ด้วย แล้วก็เตือนตอนใกล้ limit นะ อะไรงี้ครับ'.repeat(2)
const BETTER = 'Goal: add a usage bar that shows progress and warns near the limit.'

// The hooks below stand for the engine: the model answers, the store is empty, the prompt enters.
// $.ui.ask is a tool.call of AskUserQuestion, answered here with the label the test picks.
const engine = (on: any, pick: string) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: BETTER, usage: {} } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: any) => ({
    result: { questions: e.questions, answers: { [e.questions[0].question]: pick } },
  }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context }))
}

test('a long prompt is replaced by the Power Up version when the user picks it', async ($, on) => {
  engine(on, 'ใช้ฉบับ Power Up (Use Power Up)')
  const r: any = await $.prompt.submit({ text: LONG, origin: { kind: 'composer' }, wait: false } as any)
  expect(r.text).toBe(BETTER)
})

test('keeping the original sends what was typed', async ($, on) => {
  engine(on, 'ใช้ข้อความเดิม (Keep original)')
  const r: any = await $.prompt.submit({ text: LONG, origin: { kind: 'composer' }, wait: false } as any)
  expect(r.text).toBe(LONG)
})

test('a short prompt goes through untouched', async ($, on) => {
  engine(on, 'ใช้ฉบับ Power Up (Use Power Up)')
  const r: any = await $.prompt.submit({ text: 'ok ทำเลย', origin: { kind: 'composer' }, wait: false } as any)
  expect(r.text).toBe('ok ทำเลย')
})

test('++ forces a short prompt, a dictation-app marker too', async ($, on) => {
  engine(on, 'ใช้ฉบับ Power Up (Use Power Up)')
  const a: any = await $.prompt.submit({ text: '++ fix bug', origin: { kind: 'composer' }, wait: false } as any)
  expect(a.text).toBe(BETTER)
  const b: any = await $.prompt.submit({ text: '⁣fix bug', origin: { kind: 'composer' }, wait: false } as any)
  expect(b.text).toBe(BETTER)
})

test('-- skips and is removed', async ($, on) => {
  engine(on, 'ใช้ฉบับ Power Up (Use Power Up)')
  const r: any = await $.prompt.submit({ text: '-- ' + LONG, origin: { kind: 'composer' }, wait: false } as any)
  expect(r.text).toBe(LONG)
})

test('back to edit drops the prompt', async ($, on) => {
  engine(on, 'กลับไปแก้ (Back to edit)')
  const r: any = await $.prompt.submit({ text: LONG, origin: { kind: 'composer' }, wait: false } as any)
  expect(typeof r.drop).toBe('string')
})
