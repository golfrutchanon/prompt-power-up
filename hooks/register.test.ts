import { expect, test } from 'claude-code/testing'

const LONG =
  'เอ่อ คือว่าอยากให้ช่วยทำ usage bar แบบว่า ที่มันโชว์ token อะ ไม่ใช่ๆ เอาเป็น progress ด้วย แล้วก็เตือนตอนใกล้ limit นะ อะไรงี้ครับ'.repeat(
    2,
  )
const BETTER = 'Goal: add a usage bar that shows progress and warns near the limit.'

const SEND = 'ส่งฉบับนี้ (Send this)'
const RETRY = 'ตรวจใหม่ (Check again)'
const KEEP = 'ใช้ข้อความเดิม (Keep original)'
const EDIT = 'กลับไปแก้ (Back to edit)'

type Reply = { isAnswered: true; text: string; usage: Record<string, never> }
const says = (text: string): Reply => ({ isAnswered: true, text, usage: {} })

/** What one run of the engine saw, so a test can assert on the request and not only the answer. */
type Seen = { models: string[]; efforts: string[]; prompts: string[]; picks: number; logs: string[]; fire: () => void; invalidates: number }

// The hooks below stand for the engine: the model answers, the store holds `settings`, the
// transcript holds `messages`, the prompt enters. $.ui.ask is a tool.call of AskUserQuestion,
// answered with the labels the test lists, one per round.
const engine = (
  on: any,
  opts: { picks?: string[]; settings?: unknown; reply?: (prompt: string) => string; messages?: unknown[]; holdTimer?: boolean } = {},
): Seen => {
  const seen: Seen = { models: [], efforts: [], prompts: [], picks: 0, logs: [], fire: () => {}, invalidates: 0 }
  on('store.get', () => ({ value: opts.settings }))
  on('store.set', () => ({ value: undefined }))
  on('session.messages', () => ({ value: opts.messages ?? [] }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('model.complete', (_: unknown, e: any) => {
    seen.models.push(e.model)
    seen.efforts.push(e.effort)
    const prompt = typeof e.prompt === 'string' ? e.prompt : e.prompt.map((b: any) => b.text).join('')
    seen.prompts.push(prompt)
    return { value: says(opts.reply ? opts.reply(prompt) : BETTER) }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: any) => {
    const pick = opts.picks?.[seen.picks] ?? KEEP
    seen.picks++
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: pick } } }
  })
  on('ui.log', (_: unknown, e: any) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => {
    seen.invalidates++
    return { value: undefined }
  })
  on('clock.after', () =>
    opts.holdTimer
      ? new Promise(resolve => {
          seen.fire = () => resolve({ value: undefined })
        })
      : { value: undefined },
  )
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context }))
  return seen
}

declare const h: any

const send = ($: any, text: string, turnId?: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...(turnId && { turnId }) } as any) as Promise<any>

// ---- Mode: rewrite -------------------------------------------------------------------------

test('rewrite + ask: the Power Up version is sent when the person picks it', async ($, on) => {
  engine(on, { picks: [SEND] })
  expect((await send($, LONG)).text).toBe(BETTER)
})

test('rewrite + ask: keeping the original sends what was typed', async ($, on) => {
  engine(on, { picks: [KEEP] })
  expect((await send($, LONG)).text).toBe(LONG)
})

test('rewrite + ask: back to edit drops the prompt', async ($, on) => {
  engine(on, { picks: [EDIT] })
  expect(typeof (await send($, LONG)).drop).toBe('string')
})

test('rewrite + ask: ตรวจใหม่ runs another round, then sends', async ($, on) => {
  const seen = engine(on, { picks: [RETRY, RETRY, SEND] })
  expect((await send($, LONG)).text).toBe(BETTER)
  expect(seen.models.length).toBe(3)
})

test('rewrite + auto sends without asking', async ($, on) => {
  const seen = engine(on, { settings: { mode: 'rewrite', flow: 'auto', power: 'eco', minChars: 120 } })
  expect((await send($, LONG)).text).toBe(BETTER)
  expect(seen.picks).toBe(0)
})

// ---- What the person sees ------------------------------------------------------------------

const AUTO = { mode: 'rewrite', flow: 'auto', power: 'full', minChars: 120 }

test('rewrite + auto with nothing drawn shows the rewrite in a row and sends the rewrite', async ($, on) => {
  const seen = engine(on, { settings: AUTO })
  expect((await send($, LONG)).text).toBe(BETTER)
  await settle()
  const shown = seen.logs.join('\n')
  expect(shown).toContain('Prompt ที่เรียบเรียงใหม่')
  expect(shown).toContain(BETTER)
})

test('rewrite + ask shows both before the person picks', async ($, on) => {
  const seen = engine(on, { picks: [SEND], settings: { ...AUTO, flow: 'ask' } })
  await send($, LONG)
  const shown = seen.logs.join('\n')
  expect(shown).toContain(LONG)
  expect(shown).toContain(BETTER)
})

// The desktop turns a log row's line breaks into spaces, so line breaks need a drawn box.
const SECTIONS = ['**Goal:** ทำ usage bar', '**Context:** ไม่มี progress', '- ข้อหนึ่ง', '- ข้อสอง', 'Done when: เห็น bar'].join('\n')

const userRow = (text: string, surface: 'desktop' | 'terminal' = 'desktop') =>
  ({
    plugin: 'prompt-power-up',
    component: 'UserMessage',
    surface,
    props: { text, origin: { kind: 'composer' }, isExpanded: true },
  }) as any

const engineRow = (on: any) =>
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'engine row')
  })

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

test('sent while idle: the bubble has the typed words, so one block holds the rewrite', async ($, on) => {
  engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  engineRow(on)
  await send($, LONG)
  const ui = await $.ui.mount(userRow(LONG))
  const blocks = await ui.findAll({ type: 'Markdown' })
  expect(blocks.length).toBe(1)
  expect(blocks[0].text).toContain('Prompt ที่เรียบเรียงใหม่')
  expect(blocks[0].text).toContain('**Goal:** ทำ usage bar\n\n**Context:** ไม่มี progress')
  expect(blocks[0].text).toContain('- ข้อหนึ่ง\n- ข้อสอง')
  expect(blocks[0].text.includes(LONG)).toBe(false)
  await ui.unmount()
})

test('sent into a running turn: the bubble has the rewrite, so one block holds the original', async ($, on) => {
  engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  engineRow(on)
  await send($, LONG, 'turn-1')
  const ui = await $.ui.mount(userRow(SECTIONS))
  const blocks = await ui.findAll({ type: 'Markdown' })
  expect(blocks.length).toBe(1)
  expect(blocks[0].text).toContain('ข้อความเดิม')
  expect(blocks[0].text).toContain(LONG)
  expect(blocks[0].text.includes('Goal')).toBe(false)
  await ui.unmount()
})

test('a drawn block means no log rows at all', async ($, on) => {
  const seen = engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  engineRow(on)
  await send($, LONG)
  const ui = await $.ui.mount(userRow(LONG))
  await ui.find({ type: 'Markdown' })
  seen.fire()
  await settle()
  expect(seen.logs).toEqual([])
  await ui.unmount()
})

test('with nothing drawn the same one block comes as one log row', async ($, on) => {
  const seen = engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  await send($, LONG + '\nบรรทัดสอง')
  seen.fire()
  await settle()
  expect(seen.logs.length).toBe(1)
  expect(seen.logs[0]).toContain('▸ Goal: ทำ usage bar')
  expect(seen.logs.some(l => l.includes('\n') || l.includes('**'))).toBe(false)
})

test('rewrite + ask shows exactly two log rows before the person picks', async ($, on) => {
  const seen = engine(on, { picks: [SEND], settings: { ...AUTO, flow: 'ask' }, reply: () => SECTIONS })
  await send($, LONG)
  expect(seen.logs.length).toBe(2)
})

test('the blocks are only for show: Claude gets the rewrite exactly as written', async ($, on) => {
  engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  expect((await send($, LONG)).text).toBe(SECTIONS)
})

test('a row the mod did not rewrite is left to the engine', async ($, on) => {
  engine(on, { settings: AUTO })
  engineRow(on)
  const ui = await $.ui.mount(userRow('ข้อความอื่นที่ไม่เกี่ยว'))
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('the paste wrapper never shows, and still goes to Claude as it was', async ($, on) => {
  const pasted = '<pasted_content id="026c">\n' + LONG + '\n</pasted_content id="026c">'
  const seen = engine(on, { settings: AUTO, reply: () => pasted + ' เพิ่ม', holdTimer: true })
  const sent = await send($, pasted, 'turn-1')
  expect(sent.text).toBe(pasted + ' เพิ่ม')
  seen.fire()
  await settle()
  expect(seen.logs.join(' ').includes('pasted_content')).toBe(false)
  expect(seen.logs[0]).toContain(LONG)
})

test('a rewrite asks for a redraw, since the row may already be drawn from the typed text', async ($, on) => {
  const seen = engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  await send($, LONG)
  expect(seen.invalidates).toBe(1)
})

test('the block is dim and labelled with the mod, so it cannot read as the reply', async ($, on) => {
  engine(on, { settings: AUTO, reply: () => SECTIONS, holdTimer: true })
  engineRow(on)
  await send($, LONG)
  const ui = await $.ui.mount(userRow(SECTIONS))
  const labels = await ui.findAll({ type: 'Text', text: /^prompt-power-up$/ })
  expect(labels.length).toBe(1)
  const blocks = await ui.findAll({ type: 'Markdown' })
  expect(blocks.every((b: any) => b.props?.dimColor === true || b.dimColor === true)).toBe(true)
  await ui.unmount()
})

test('rewrite that changes nothing says the original went', async ($, on) => {
  const seen = engine(on, { settings: AUTO, reply: () => LONG })
  expect((await send($, LONG)).text).toBe(LONG)
  expect(seen.logs.join('\n')).toContain('ส่งข้อความเดิม')
})

test('a rewrite that fails says the original went, in a line that stays', async ($, on) => {
  const seen = engine(on, { settings: AUTO, reply: () => '   ' })
  expect((await send($, LONG)).text).toBe(LONG)
  expect(seen.logs.join('\n')).toContain('ส่งข้อความเดิม')
})

test('rewrite leaves a prompt shorter than minChars alone', async ($, on) => {
  const seen = engine(on, { picks: [SEND] })
  expect((await send($, 'ok ทำเลย')).text).toBe('ok ทำเลย')
  expect(seen.models.length).toBe(0)
})

// ---- The shortcuts are gone ---------------------------------------------------------------

test('++ and -- are no longer shortcuts: they are ordinary text', async ($, on) => {
  engine(on, { picks: [SEND, SEND] })
  // `--` used to skip; a long prompt now gets rewritten like any other.
  expect((await send($, '-- ' + LONG)).text).toBe(BETTER)
  // `++` used to force a short prompt; it is below minChars, so nothing happens and the
  // characters stay in the text rather than being eaten.
  expect((await send($, '++ fix bug')).text).toBe('++ fix bug')
})

test('a dictation-app marker is stripped but forces nothing', async ($, on) => {
  const seen = engine(on, { picks: [SEND] })
  expect((await send($, '⁣fix bug')).text).toBe('fix bug')
  expect(seen.models.length).toBe(0)
})

// ---- Mode: fix -----------------------------------------------------------------------------

const FIX_ON = { mode: 'fix', flow: 'auto', power: 'eco', minChars: 120 }

test('fix replaces the words it names and leaves the sentence alone', async ($, on) => {
  engine(on, {
    settings: FIX_ON,
    reply: () => '{"fixes":[{"from":"course","to":"Claude"},{"from":"บราน","to":"branch"}]}',
  })
  const r = await send($, 'ลอง course code กับ บราน ใหม่')
  expect(r.text).toBe('ลอง Claude code กับ branch ใหม่')
})

test('fix runs on a short prompt, where rewrite would not', async ($, on) => {
  const seen = engine(on, { settings: FIX_ON, reply: () => '{"fixes":[{"from":"คมมิต","to":"commit"}]}' })
  expect((await send($, 'คมมิต')).text).toBe('commit')
  expect(seen.models.length).toBe(1)
})

test('fix drops a replacement whose "from" is not in the message', async ($, on) => {
  engine(on, { settings: FIX_ON, reply: () => '{"fixes":[{"from":"ไม่มีคำนี้","to":"anything"}]}' })
  const typed = 'เปิด log ขึ้นมาดู'
  expect((await send($, typed)).text).toBe(typed)
})

test('fix drops a replacement spanning more than one word, so it cannot rewrite', async ($, on) => {
  engine(on, { settings: FIX_ON, reply: () => '{"fixes":[{"from":"เปิดจริง log","to":"เปิด screen lock ไว้"}]}' })
  const typed = 'เปิดจริง log ขึ้น'
  expect((await send($, typed)).text).toBe(typed)
})

test('fix sends the message as typed when the reply is not JSON', async ($, on) => {
  engine(on, { settings: FIX_ON, reply: () => 'sure, here is the corrected sentence!' })
  const typed = 'เปิด log ขึ้นมาดู'
  expect((await send($, typed)).text).toBe(typed)
})

test('fix with nothing to change never asks, even under the ask flow', async ($, on) => {
  const seen = engine(on, {
    settings: { ...FIX_ON, flow: 'ask' },
    reply: () => '{"fixes":[]}',
  })
  const typed = 'เปิด log ขึ้นมาดู'
  expect((await send($, typed)).text).toBe(typed)
  expect(seen.picks).toBe(0)
})

test('fix sends the conversation it was given: the term list and the recent text', async ($, on) => {
  const seen = engine(on, {
    settings: FIX_ON,
    reply: () => '{"fixes":[]}',
    messages: [
      { role: 'user', text: 'แก้ polish.py ใน worktree ให้หน่อย', toolUses: [] },
      { role: 'assistant', text: 'แก้ที่ thai_dictate/polish.py แล้วครับ', toolUses: [] },
    ],
  })
  await send($, 'คมมิต ให้ด้วย')
  const sent = seen.prompts[0] ?? ''
  expect(sent.includes('<terms>')).toBe(true)
  expect(sent.includes('polish.py')).toBe(true)
  expect(sent.includes('worktree')).toBe(true)
  expect(sent.includes('<recent>')).toBe(true)
  expect(sent.includes('<message>\nคมมิต ให้ด้วย\n</message>')).toBe(true)
})

test('fix never sends tool output, however much of it the transcript holds', async ($, on) => {
  const seen = engine(on, {
    settings: FIX_ON,
    reply: () => '{"fixes":[]}',
    messages: [
      {
        role: 'assistant',
        text: 'อ่านไฟล์ให้แล้ว',
        toolUses: [{ name: 'Read', text: 'SECRET_DUMP '.repeat(500), result: 'SECRET_DUMP' }],
      },
    ],
  })
  await send($, 'คมมิต ให้ด้วย')
  expect((seen.prompts[0] ?? '').includes('SECRET_DUMP')).toBe(false)
})

test('fix holds the recent text to the tier budget, however long the chat is', async ($, on) => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: 'ประโยคยาวพอประมาณสำหรับการทดสอบงบตัวอักษร '.repeat(10),
    toolUses: [],
  }))
  const seen = engine(on, { settings: FIX_ON, reply: () => '{"fixes":[]}', messages: many })
  await send($, 'คมมิต ให้ด้วย')
  const recent = (seen.prompts[0] ?? '').split('<recent>')[1]?.split('</recent>')[0] ?? ''
  // eco's ceiling is 2000 characters; the role labels and joins add a little on top.
  expect(recent.length < 2600).toBe(true)
})

// ---- Power ---------------------------------------------------------------------------------

// Each tier is its own test: the hooks beneath the plugins are registered before the first `$`
// call, so one test cannot stand up the engine twice.
const tier = (power: 'eco' | 'mid' | 'full', model: string) =>
  test(`Power ${power} calls ${model} at high effort`, async ($, on) => {
    const seen = engine(on, {
      settings: { mode: 'fix', flow: 'auto', power, minChars: 120 },
      reply: () => '{"fixes":[]}',
    })
    await send($, 'คมมิต ให้ด้วย')
    expect(seen.models[0]).toBe(model)
    expect(seen.efforts[0]).toBe('high')
  })

tier('eco', 'haiku')
tier('mid', 'sonnet')
tier('full', 'opus')

test('the mod model does not follow the chat model', async ($, on) => {
  const seen = engine(on, {
    settings: { mode: 'fix', flow: 'auto', power: 'eco', minChars: 120 },
    reply: () => '{"fixes":[]}',
  })
  await send($, 'คมมิต ให้ด้วย')
  // The chat runs claude-opus-5 (session.model above); eco still calls haiku.
  expect(seen.models[0]).toBe('haiku')
})

test('model auto is the way to follow the chat model', async ($, on) => {
  const seen = engine(on, {
    settings: { mode: 'fix', flow: 'auto', power: 'eco', minChars: 120, modelOverride: 'auto' },
    reply: () => '{"fixes":[]}',
  })
  await send($, 'คมมิต ให้ด้วย')
  expect(seen.models[0]).toBe('claude-opus-5')
})

test('model <name> pins the model whatever the tier', async ($, on) => {
  const seen = engine(on, {
    settings: { mode: 'fix', flow: 'auto', power: 'full', minChars: 120, modelOverride: 'haiku' },
    reply: () => '{"fixes":[]}',
  })
  await send($, 'คมมิต ให้ด้วย')
  expect(seen.models[0]).toBe('haiku')
})

// ---- off, and settings written before the three dials --------------------------------------

test("a stored 'medium' from 0.2.0 still runs the middle tier", async ($, on) => {
  const seen = engine(on, {
    settings: { mode: 'fix', flow: 'auto', power: 'medium', minChars: 120 },
    reply: () => '{"fixes":[]}',
  })
  await send($, 'คมมิต ให้ด้วย')
  expect(seen.models[0]).toBe('sonnet')
})

test('off lets everything through untouched', async ($, on) => {
  const seen = engine(on, { settings: { mode: 'off', flow: 'ask', power: 'eco', minChars: 120 } })
  expect((await send($, LONG)).text).toBe(LONG)
  expect(seen.models.length).toBe(0)
})

test('a setting written when mode held the flow becomes rewrite with that flow', async ($, on) => {
  // The old shape: { mode: 'auto', minChars: 120, model: 'haiku' }. `model` is read under its
  // new name now, so the old value must not pin every tier to haiku.
  const seen = engine(on, { settings: { mode: 'auto', minChars: 120, model: 'sonnet' } })
  expect((await send($, LONG)).text).toBe(BETTER)
  expect(seen.picks).toBe(0)
  expect(seen.models[0]).toBe('haiku')
})
