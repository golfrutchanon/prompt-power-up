// Prompt Power Up — correct the words you dictated, or rewrite a rambling prompt,
// before Claude reads it.
//
// It works on whatever is in the prompt box when Enter is pressed, so the text can come from
// typing, pasting, Claude Code's own voice input, or any dictation app that types into the
// focused field (macOS Dictation, MacWhisper, Wispr Flow, VoiceInk, superwhisper).
//
// Three dials, each set on its own:
//   Mode   rewrite  restructure the whole prompt | fix  correct words, cut filler | off
//   Flow   auto     send it                      | ask  show it, the person picks
//   Power  eco (haiku) | mid (sonnet) | full (opus)
//
// Power picks the judge, and how far back Fix mode reads. Fix reads the conversation through
// $.session.messages() under a fixed character budget, so what it sends never grows with the
// chat: a session at 90% of its context window costs Fix exactly what an empty one does.
//
// It deliberately does NOT use $.model.fork. Fork would send the session's whole context
// window — slow, expensive, and growing all session — and is locked to the main thread's
// model, so no Power tier would be possible. $.model.complete takes any model regardless of
// what the chat runs on, which is what makes the tiers independent of the conversation.
import type { Register, EngineInterface, ModelEffort, PromptSubmitInput, RenderSurface } from 'claude-code'

type Mode = 'rewrite' | 'fix' | 'off'
type Flow = 'auto' | 'ask'
type Power = 'eco' | 'mid' | 'full'

type Settings = {
  mode: Mode
  flow: Flow
  power: Power
  minChars: number
  /** Overrides the tier's model: a model name, or 'auto' for whatever the chat runs on. */
  modelOverride?: string
}

const DEFAULTS: Settings = { mode: 'rewrite', flow: 'ask', power: 'eco', minChars: 120 }

type Tier = {
  model: string
  effort: ModelEffort
  /** Characters of recent conversation Fix may send. The ceiling, never a target. */
  chars: number
  /** How many messages back the term list is gathered from; free, it costs no tokens. */
  reach: number
  timeoutMs: number
}

// `high` on all three tiers, asked for. So the tiers differ by judge and by how much of the
// conversation Fix reads back — not by how hard the model thinks.
// Listing cuts is slow: a filler-heavy message took Haiku 15-26 s against about 3 s for words alone,
// and a timeout sends the message uncleaned, so the ceilings sit well above that.
const POWER: Record<Power, Tier> = {
  eco: { model: 'haiku', effort: 'high', chars: 2000, reach: 40, timeoutMs: 45000 },
  mid: { model: 'sonnet', effort: 'high', chars: 6000, reach: 40, timeoutMs: 60000 },
  full: { model: 'opus', effort: 'high', chars: 12000, reach: 60, timeoutMs: 90000 },
}

// What a dictation app can put in front of the text: U+2063 (invisible separator) or the
// microphone emoji. It is stripped so it never reaches the model; it forces nothing.
const APP_MARKERS = ['⁣', '🎙️', '🎙']

const USE_NEW = 'ส่งฉบับนี้ (Send this)'
const RETRY = 'ตรวจใหม่ (Check again)'
const KEEP = 'ใช้ข้อความเดิม (Keep original)'
const EDIT = 'กลับไปแก้ (Back to edit)'
const MAX_ROUNDS = 3
const BOX_WAIT_MS = 2500

const SYSTEM = `You turn a person's raw message to an AI coding assistant into a clear, well-structured prompt.
The message is often dictated speech: fillers, repetitions, self-corrections, ideas out of order, Thai and English mixed.

Rules:
- Write in the SAME language mix the person used. Thai stays Thai; keep English technical terms, names, file names, commands and code exactly as given.
- Keep every request, detail, constraint and example the person gave. Never add facts, requirements or guesses they did not say.
- When they corrected themselves ("no, not that... I mean"), keep only the final intent.
- Remove fillers (เอ่อ, อ่า, แบบว่า, คือ, อะไรงี้, um, like, you know) and repetition.
- Organise it so the assistant can act on it. Use the parts that apply, as short headings or bullets:
  Goal (one sentence), Context, Requirements / constraints, Expected output / done when.
  A short or simple request stays short: one or two clear sentences, no headings.
- If something important is ambiguous, add a final line asking the assistant to confirm that point first.
- Output ONLY the rewritten prompt. Do not answer it, do not explain, no preamble, no quotes around it.`

// Fix mode asks for a list of replacements rather than a corrected sentence. Handed a sentence
// to return, a model sometimes returns a different sentence: "เปิดจริง log ขึ้น" came back once
// as "เปิด screen lock ไว้". A replacement has to name text that is really in the message, so
// the sentence survives by construction and no wording in the instructions has to be trusted
// for it.
const FIX_SYSTEM = `You clean a person's message to an AI coding assistant: you correct individual wrong words and cut filler words. You never rewrite it.
The message is dictated speech, Thai and English mixed, so words come out misheard or misspelled, with hesitations in between.

You are given, in order:
<terms>   technical words as this conversation spells them. A misheard word is very often one of these.
<recent>  the last stretch of the conversation, for the topic and who said what.
<message> the message to clean. ONLY this text is to be changed.

Correct only these, under "fixes":
- an English word heard as Thai letters that are not a real Thai word: 'เดพลอย' -> 'deploy', 'คมมิตร' -> 'commit', 'ไอแปร' -> 'iPad'
- an English word heard as the wrong English word: 'Claude' -> 'cloud', 'Brand' -> 'branch', 'Depth' -> 'dev', 'course' -> 'Claude'
- a plainly misspelled Thai or English word: 'ตรวจค้ำ' -> 'ตรวจคำ', 'recieve' -> 'receive'

Use <terms> and <recent> to decide which word was meant.

Cut only these, under "cuts":
- hesitation sounds: เอ่อ เอ้อ เออ อืม อึม อือ อ่า อา um uh erm hmm
- spoken filler that adds no meaning where it stands: แบบว่า คือว่า ประมาณว่า อะไรงี้ อะไรแบบนี้ อะไรพวกนี้ อะไรทำนองนี้ อะ อ่ะ น่ะ เนี่ย you know, I mean, like
- 'แบบ' when it only fills a gap: 'มันแบบช้ามาก' cuts it, 'ทำแบบนี้' and 'แบบฟอร์ม' keep it
- a word said twice in a row by stumbling: 'ผมผมคิดว่า' cuts one 'ผม'

Each cut is one string: copy a few characters of <message> around the filler, exactly, and put [ ] around the filler. Give every occurrence its own string.
Copy the spaces as they are in <message>: never add one, and put a space inside the [ ] only if it follows the filler in <message>.
'ผมว่าเอ่อเอ่อคิดว่าดี' gives "ผมว่า[เอ่อเอ่อ]คิดว่า". 'เอ่อ ทำ log ใหม่ อะไรงี้ครับ' gives "[เอ่อ ]ทำ" and "ใหม่ [อะไรงี้]ครับ".

Keep these, they mean something: 'ปัญหาคือมันช้า', 'แบบฟอร์ม', 'ทำแบบนี้', 'อะไรพัง', 'อาหาร', 'like this one'. Polite words such as ครับ ค่ะ นะ stay.
A filler the person is talking about stays too: in 'ช่วยตัดคำพวกเอ่ออืมออก' the words เอ่ออืม are the topic, not hesitation.

Reply with JSON only, no prose, no code fence:
{"fixes": [{"from": "<exact text in the message>", "to": "<the right word>"}], "cuts": ["<before>[<filler>]<after>"]}

Rules:
- "from" and every cut must appear in <message> exactly, character for character. Never text that is only in <terms> or <recent>.
- "from" must be ONE word with no spaces inside it. Never a phrase, clause or sentence.
- A cut holds filler only, never a word the sentence needs, and every cut has text beside its [ ].
- Text in <pasted_content> is usually the person's own dictation, so clean it the same way. Leave alone a log, code, or a document someone else wrote.
- Do not rephrase, reorder, expand, translate or repunctuate anything.
- A correctly spelled Thai word is not an error, even if an English word exists for it.
- When unsure, leave it alone. Changing nothing is better than changing it wrongly.
- Nothing to do: {"fixes": [], "cuts": []}`

const MAX_FROM = 14
const MAX_TO = 20
const MAX_CUT = 24
// Filler is rarely this much of a message. Past it the model is rewriting, so its cuts all go.
// Hesitation sounds do not count: a short 'เอ่อ ทำเลย' is mostly sound and is safe to clean.
const MAX_CUT_SHARE = 0.4

// A cut naming these would change what the sentence says, however sure the model is.
const NEVER_CUT = /ไม่|อย่า|ห้าม|\bnot?\b|n't|\bnever\b/i
// Filler is words. Anything with these in it is a number, a path or code.
const NOT_FILLER = /[\d`_=<>{}()/\\]/
// Sounds the word breaker cannot be trusted on: it splits 'เอ่ออืมอา' as 'เอ่อ|อื|มอา'.
const SOUNDS = /^(?:(?:เอ่อ|เอ้อ|เออ|อืม+|อึม+|อือ+|อ่า+|อา+|um+|uh+|erm+|hmm+)[\s,]*)+$/i
// Quoted code stays as it is. Pasted text is not on this list: a dictation app pastes into the
// box, so the app's paste wrapper holds exactly the speech this mode is for.
const CODE = /```[\s\S]*?```|`[^`\n]*`/g

const WORDS = new Intl.Segmenter('th', { granularity: 'word' })

function wordEdges(text: string): Set<number> {
  const edges = new Set<number>([text.length])
  for (const s of WORDS.segment(text)) edges.add(s.index)
  return edges
}

type Span = { start: number; end: number; word: string; isSound: boolean }

/**
 * Where the cuts land, found in the text as sent. Finding them all before removing any matters:
 * "ผมว่า[เอ่อ]เอ่อคิด" and "ผมว่าเอ่อ[เอ่อ]คิด" each name text the other would destroy.
 */
function findCuts(text: string, cuts: unknown[]): Span[] {
  const edges = wordEdges(text)
  const code = [...text.matchAll(CODE)].map(m => [m.index, m.index + m[0].length] as const)
  const spans: Span[] = []
  for (const item of cuts) {
    const m = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/.exec(String(item ?? ''))
    if (!m) continue
    const [, before = '', word = '', after = ''] = m
    // With nothing beside it, 'อา' would come out of 'อาหาร' and 'อาการ' too.
    if (!before && !after) continue
    if (word.length > MAX_CUT || NEVER_CUT.test(word) || NOT_FILLER.test(word)) continue
    const isSound = SOUNDS.test(word.trim())
    const whole = before + word + after
    for (let at = text.indexOf(whole); at !== -1; at = text.indexOf(whole, at + 1)) {
      // Only the filler itself: 'อะไร[อะ ]auto' takes the space it needs along with it otherwise.
      // removeSpans decides what happens to the space.
      const start = at + before.length + (word.length - word.trimStart().length)
      const end = at + before.length + word.trimEnd().length
      if (end <= start) continue
      if (code.some(([from, to]) => start < to && end > from)) continue
      if (!isSound && !(edges.has(start) && edges.has(end))) continue
      spans.push({ start, end, word: word.trim(), isSound })
    }
  }
  // The same filler named twice is one cut, and counts as one.
  const seen = new Set<string>()
  return spans
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter(({ start, end }) => {
      const key = `${start}:${end}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Takes the spans out, along with the space that would otherwise be left doubled or dangling. */
function removeSpans(text: string, spans: Span[]): string {
  let out = ''
  let from = 0
  for (const span of spans) {
    if (span.start < from) {
      // Two cuts that overlap: only the part not already gone is left to skip.
      from = Math.max(from, span.end)
      continue
    }
    out += text.slice(from, span.start)
    from = span.end
    if (!out || /\s$/.test(out)) {
      while (text[from] === ' ' || text[from] === '\t') from++
    }
    if (from === text.length || text[from] === '\n') out = out.replace(/[ \t]+$/, '')
  }
  return out + text.slice(from)
}

/** 'เอ่อ ×3 · อืม', so a person reads what went without reading it three times. */
function namedCuts(spans: Span[]): string {
  const count = new Map<string, number>()
  for (const { word } of spans) count.set(word, (count.get(word) ?? 0) + 1)
  return [...count].map(([word, n]) => (n > 1 ? `${word} ×${n}` : word)).join(' · ')
}

// Applies the model's edits here rather than taking its sentence back. A fix or a cut naming text
// that is not in the message is dropped, a fix spanning more than one word is dropped, and a cut
// can only take text away: that is the whole protection against a rewrite.
function applyFixes(text: string, reply: string): { out: string; applied: string[] } {
  let parsed: { fixes?: { from?: string; to?: string }[]; cuts?: unknown }
  try {
    parsed = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
  } catch {
    return { out: text, applied: [] }
  }
  const applied: string[] = []

  // Cuts go first: their snippets are copied from the message as sent, before any fix changes it.
  let out = text
  const spans = findCuts(text, Array.isArray(parsed.cuts) ? parsed.cuts : [])
  const wordy = spans.filter(s => !s.isSound).reduce((sum, s) => sum + s.end - s.start, 0)
  if (spans.length > 0 && wordy / text.length <= MAX_CUT_SHARE) {
    const cleaned = removeSpans(text, spans)
    // A message of nothing but filler still has to say something to Claude.
    if (cleaned.trim()) {
      out = cleaned
      applied.push('ตัด ' + namedCuts(spans))
    }
  }

  for (const f of parsed.fixes ?? []) {
    const from = String(f?.from ?? '')
    const to = String(f?.to ?? '')
    // No empty "to": a fix replaces everywhere, so 'อะ' -> '' would turn 'อะไร' into 'ไร'.
    if (!from || !to || from === to || !out.includes(from)) continue
    if (/\s/.test(from) || from.length > MAX_FROM || to.length > MAX_TO) continue
    out = out.split(from).join(to)
    applied.push(`${from} → ${to}`)
  }
  return { out, applied }
}

// A word, a file name, a path, an identifier: polish.py, thai_dictate/vad.py, CFBundleExecutable.
const TERM = /[A-Za-z][A-Za-z0-9]*(?:[._/-][A-Za-z0-9]+)*/g
const TERM_CAP = 120
// Kept out of the list so the budget goes to words worth spelling right.
const COMMON = new Set([
  'about', 'after', 'again', 'because', 'before', 'could', 'every', 'first', 'their', 'there',
  'these', 'thing', 'think', 'those', 'where', 'which', 'while', 'would', 'should', 'something',
  'anything', 'nothing', 'really', 'other', 'maybe', 'still', 'never', 'always', 'right',
])

// Worth listing: it carries a separator, an inner capital, a digit, or starts with a capital —
// otherwise it has to be long enough not to be an ordinary English word.
function isTerm(t: string): boolean {
  if (t.length < 3) return false
  if (/[._/-]/.test(t) || /\d/.test(t) || /[a-z][A-Z]/.test(t)) return true
  if (/^[A-Z]/.test(t)) return true
  return t.length >= 5 && !COMMON.has(t.toLowerCase())
}

/** The conversation Fix reads: a term list gathered wide, and recent prose under a hard cap. */
async function conversation($: EngineInterface, tier: Tier): Promise<{ terms: string; recent: string }> {
  let found: unknown
  try {
    found = await $.session.messages()
  } catch {
    return { terms: '', recent: '' }
  }
  if (!Array.isArray(found)) return { terms: '', recent: '' }
  const msgs = found as { role: string; text?: string }[]

  // Newest first for both passes, so a budget that runs out drops the oldest.
  const newest = msgs.slice(-tier.reach).reverse()

  const terms: string[] = []
  const seen = new Set<string>()
  for (const m of newest) {
    for (const t of (m.text ?? '').match(TERM) ?? []) {
      if (!isTerm(t) || seen.has(t)) continue
      seen.add(t)
      terms.push(t)
      if (terms.length >= TERM_CAP) break
    }
    if (terms.length >= TERM_CAP) break
  }

  // Prose: message text only. toolUses and toolResults are left out on purpose — one file read
  // or grep can be thousands of lines and would eat the whole budget without saying anything
  // about which word was meant.
  const kept: string[] = []
  let used = 0
  for (const m of newest) {
    const body = (m.text ?? '').trim()
    if (!body) continue
    const line = `${m.role}: ${body}`
    if (used + line.length > tier.chars) break
    kept.push(line)
    used += line.length
  }

  return { terms: terms.join(' '), recent: kept.reverse().join('\n\n') }
}

// Settings from before the three dials used `mode` for the flow ('ask' | 'auto') and `model` for
// the only model there was. Carry those over rather than dropping the person back to the
// defaults; `model` is read under its new name, so an old 'haiku' no longer pins every tier.
function withDefaults(saved: unknown): Settings {
  const old = (saved ?? {}) as Partial<Settings>
  const s: Settings = { ...DEFAULTS, ...old }
  // Read the old `mode` loosely: it held the flow back when that was the only dial.
  const was = (old as { mode?: string }).mode
  if (was === 'ask' || was === 'auto') {
    s.mode = 'rewrite'
    s.flow = was
  }
  // The middle tier was called 'medium' in 0.2.0; a stored one would index POWER as undefined.
  if ((old as { power?: string }).power === 'medium') s.power = 'mid'
  return s
}

const clamp = (n: number) => Math.max(20, Math.min(5000, Math.round(n)))

/** The tier's model, unless the person pinned one ('auto' follows the chat's own). */
async function pickModel($: EngineInterface, s: Settings, tier: Tier): Promise<string> {
  const pinned = s.modelOverride
  if (!pinned) return tier.model
  if (pinned !== 'auto') return pinned
  try {
    return (await $.session.model()) || tier.model
  } catch {
    return tier.model
  }
}

/** What a round produced: the text to send, and the lines that show the person what changed. */
type Made = { text: string; show: string; changed: boolean }

async function runFix($: EngineInterface, text: string, tier: Tier, model: string): Promise<Made | undefined> {
  const { terms, recent } = await conversation($, tier)
  const parts = [
    terms ? `<terms>\n${terms}\n</terms>` : '',
    recent ? `<recent>\n${recent}\n</recent>` : '',
    `<message>\n${text}\n</message>`,
  ].filter(Boolean)

  let r
  try {
    r = await $.model.complete({
      model,
      system: FIX_SYSTEM,
      prompt: parts.join('\n\n'),
      effort: tier.effort,
      // A long dictation can hold dozens of cuts, each with its text beside it. A reply cut short
      // is not JSON, and that loses every edit in it.
      maxTokens: 4000,
      timeoutMs: tier.timeoutMs,
    })
  } catch {
    // The engine refused to send it: a model this session may not use, a bad cap.
    return undefined
  }
  if (!r.isAnswered || !r.text.trim()) return undefined

  const { out, applied } = applyFixes(text, r.text)
  return { text: out, show: applied.join(' · '), changed: applied.length > 0 }
}

async function runRewrite($: EngineInterface, text: string, tier: Tier, model: string): Promise<Made | undefined> {
  let r
  try {
    r = await $.model.complete({
      model,
      system: SYSTEM,
      prompt: text,
      effort: tier.effort,
      maxTokens: 2000,
      timeoutMs: tier.timeoutMs,
    })
  } catch {
    return undefined
  }
  if (!r.isAnswered || !r.text.trim()) return undefined
  const better = r.text.trim()
  return { text: better, show: better, changed: better !== text }
}

/**
 * The two blocks the person reads in the chat: what they wrote, and what the mod made of it.
 * Neither reaches the model, so showing them costs no tokens.
 */
type Shown = {
  original: string
  rewritten: string
  heading: string
  /** What Fix changed, named word by word. Empty for a rewrite, whose changes are the whole text. */
  changes: string
  isDrawn: boolean
  /** The text as sent, which the person's own row shows: what Claude really reads. */
  sent: string
  /**
   * What the app's bubble holds if nothing is drawn through this mod. Sent while idle it keeps the
   * typed words; delivered into a running turn it holds the rewrite (seen on the desktop).
   */
  bubbleHasRewrite: boolean
}

const ORIGINAL_HEADING = '⚡ Power Up · 📝 ข้อความเดิม'

// The app wraps pasted text in these tags on the way to the engine. They are for the model; the
// person never typed them. Only what is shown loses them: the sent text stays as it was.
const forDisplay = (text: string) => text.replace(/<\/?pasted_content\b[^>]*>/g, '').trim()

const LABEL = 'prompt-power-up'

// A rewrite can miss what was meant; then the person wants their own words back, not to say it all again.
const COPY_ORIGINAL = '📋 คัดลอกข้อความเดิม'

/**
 * Puts the original on the clipboard of the surface the press came from. A remote surface (the
 * desktop app) may have no clipboard path for a mod yet, so macOS's own pbcopy is the fallback;
 * it goes through the permission check like any Bash call.
 */
async function copyOriginal($: EngineInterface, text: string, surface: RenderSurface) {
  try {
    if ((await $.ui.copy({ text, surface })).isCopied) {
      $.ui.toast('คัดลอกข้อความเดิมแล้ว')
      return
    }
  } catch {
    // fall through to pbcopy
  }
  let end = 'PPUP_EOF'
  while (text.includes(end)) end += '_'
  try {
    const r: any = await $.tool.call({
      tool: 'Bash',
      command: `printf '%s' "$(cat <<'${end}'\n${text}\n${end}\n)" | pbcopy`,
      description: 'Copy the original prompt to the clipboard',
    } as any)
    if (!r?.isError) {
      $.ui.toast('คัดลอกข้อความเดิมแล้ว')
      return
    }
  } catch {
    // no Bash, or it was refused
  }
  $.ui.toast('คัดลอกไม่สำเร็จ ลองลากคลุมข้อความแทน')
}

const changesLine = (entry: Shown) => `🔤 แก้คำ: ${entry.changes}`

/** The block under the row. The row itself holds what was sent, so what changed and the original are left. */
const blockOf = (entry: Shown) => {
  const original = `**${ORIGINAL_HEADING}**\n\n${withLineBreaks(entry.original)}`
  return entry.changes ? `**${changesLine(entry)}**\n\n${original}` : original
}

// What the user row's text can be, to the blocks that go under it. The row may hold the words as
// typed or the rewrite that was stored, so both find it. Module state: a reload forgets it, and
// the row then draws as the engine draws it, nothing lost.
const shown = new Map<string, Shown>()
const MAX_SHOWN = 50

function remember(keys: readonly string[], entry: Shown) {
  for (const key of keys) shown.set(key.trim(), entry)
  for (const oldest of shown.keys()) {
    if (shown.size <= MAX_SHOWN) break
    shown.delete(oldest)
  }
}

/** Markdown joins lines that have no blank between them; a list keeps its own tight rows. */
function withLineBreaks(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .reduce((out, line, i, lines) => {
      if (i === 0) return line
      const prev = lines[i - 1] ?? ''
      const isListed = /^\s*([-*]|\d+\.)\s/.test(line) && /^\s*([-*]|\d+\.)\s/.test(prev)
      return out + (isListed || !line || !prev ? '\n' : '\n\n') + line
    }, '')
}

// The parts SYSTEM asks the model for, when it writes them without bold or a # heading.
const SECTION = /^(goal|context|requirements?|constraints?|expected output|done when)\b[^:：]*[:：]/i

/** One line of the rewrite where markdown is not drawn: the log row would print `**` as stars. */
function toPlainPart(line: string): string {
  const isHeading = /^#{1,6}\s/.test(line) || line.startsWith('**') || SECTION.test(line)
  const plain = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '• ')
    .replace(/\*\*/g, '')
  return isHeading ? `▸ ${plain}` : plain
}

const toParts = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

const originalRow = (entry: Shown) => `${ORIGINAL_HEADING}: ${toParts(entry.original).join(' ')}`
const rewrittenRow = (entry: Shown) => `✨ ${entry.heading}: ${toParts(entry.rewritten).map(toPlainPart).join('  ')}`

/** The block in one log row, for a surface that drew nothing: only the version the bubble lacks. */
const fallbackRow = (entry: Shown) => {
  const row = entry.bubbleHasRewrite ? originalRow(entry) : rewrittenRow(entry)
  return entry.changes ? `${changesLine(entry)} · ${row}` : row
}

/**
 * Readies the user row for the text about to be sent. `isLogged` means the ask flow already put
 * both versions in the transcript, so a surface that draws nothing needs no log row on top.
 */
function showSent(e: PromptSubmitInput, text: string, made: Made, isFix: boolean, isLogged: boolean): Shown {
  const entry: Shown = {
    original: forDisplay(text),
    rewritten: forDisplay(made.text),
    heading: isFix ? 'ข้อความที่แก้แล้ว (ส่งฉบับนี้ไปแล้ว)' : 'Prompt ที่เรียบเรียงใหม่ (ส่งฉบับนี้ไปแล้ว)',
    changes: isFix ? made.show : '',
    isDrawn: isLogged,
    sent: made.text,
    bubbleHasRewrite: e.turnId !== undefined,
  }
  // The row may carry the app's paste wrapper or not, so it is found either way.
  remember([e.text, text, made.text, entry.original, entry.rewritten], entry)
  return entry
}

/** What the hook does once it has decided: send this text, or drop the prompt back to the box. */
type Action =
  | { kind: 'send'; text: string; context?: readonly string[]; show?: Shown }
  | { kind: 'drop'; why: string }

async function decide($: EngineInterface, e: PromptSubmitInput): Promise<Action> {
  const s = withDefaults(await $.store.get('settings'))
  if (s.mode === 'off') return { kind: 'send', text: e.text }

  let text = e.text
  for (const m of APP_MARKERS) {
    if (text.startsWith(m)) text = text.slice(m.length).trimStart()
  }
  if (!text.trim()) return { kind: 'send', text }
  // Fix runs at every length: a short prompt holds as many misheard words as a long one.
  // Rewrite has nothing to do with a prompt already short enough to read.
  if (s.mode === 'rewrite' && text.length < s.minChars) return { kind: 'send', text }

  const tier = POWER[s.power]
  const model = await pickModel($, s, tier)

  // Under the ask flow, 'ตรวจใหม่' comes back here for another round.
  for (let round = 1; ; round++) {
    let made: Made | undefined
    $.ui.status(s.mode === 'fix' ? '🔤 กำลังตรวจคำ…' : '⚡ Power Up กำลังเรียบเรียง prompt…')
    try {
      made = s.mode === 'fix' ? await runFix($, text, tier, model) : await runRewrite($, text, tier, model)
    } finally {
      $.ui.status(undefined)
    }

    if (made === undefined) {
      $.ui.toast(
        s.mode === 'fix'
          ? 'ตรวจคำไม่ได้ตอนนี้ ส่งข้อความเดิมไป (could not check, sent as is)'
          : 'Power Up ใช้ไม่ได้ตอนนี้ ส่งข้อความเดิมไป (could not rewrite, sent as is)',
      )
      // A toast fades. This line stays, so the person can always tell which text went.
      $.ui.log(
        s.mode === 'fix'
          ? '⚠️ ตรวจคำไม่สำเร็จ ส่งข้อความเดิมไป'
          : '⚠️ Power Up เรียบเรียงไม่สำเร็จ ส่งข้อความเดิมไป',
      )
      return { kind: 'send', text }
    }

    // Nothing changed: nothing to show, and nothing worth stopping to confirm.
    if (!made.changed) {
      $.ui.log(s.mode === 'fix' ? '🔤 ไม่พบคำที่ต้องแก้' : '⚡ Power Up ไม่ได้แก้อะไร ส่งข้อความเดิมไป')
      return { kind: 'send', text }
    }

    const isFix = s.mode === 'fix'
    if (s.flow === 'auto') {
      return { kind: 'send', text: made.text, show: showSent(e, text, made, isFix, false) }
    }

    // ask: put it in the transcript (Claude does not read log lines), then let the person pick
    if (s.mode === 'fix') {
      $.ui.log('🔤 จะแก้คำเหล่านี้: ' + made.show + '\n\n' + forDisplay(made.text))
    } else {
      // Nothing is sent yet, so there is no bubble to lean on: the person needs both to choose.
      const entry = {
        original: forDisplay(text),
        rewritten: forDisplay(made.show),
        heading: 'Prompt ที่เรียบเรียงใหม่ (รอคุณเลือก)',
        changes: '',
        isDrawn: true,
        sent: made.text,
        bubbleHasRewrite: false,
      }
      $.ui.log(originalRow(entry))
      $.ui.log(rewrittenRow(entry))
    }

    let pick: string = KEEP
    const options = round >= MAX_ROUNDS ? [USE_NEW, KEEP, EDIT] : [USE_NEW, RETRY, KEEP, EDIT]
    try {
      pick = await $.ui.ask(s.mode === 'fix' ? 'ส่งฉบับที่แก้คำแล้วไหม?' : 'ส่งฉบับ Power Up ไหม?', {
        options,
        header: 'Power Up',
      })
    } catch {
      // dismissed, or a -p run with nobody to ask: send what they wrote
    }

    if (pick === RETRY) continue
    if (pick === EDIT) {
      return { kind: 'drop', why: 'กลับไปแก้ได้เลย ฉบับที่ตรวจแล้วอยู่ใน transcript ด้านบน (edit and send again)' }
    }
    if (pick === KEEP) return { kind: 'send', text }
    const show = showSent(e, text, made, isFix, true)
    if (pick === USE_NEW) return { kind: 'send', text: made.text, show }
    // typed under "Other": treat it as extra instructions for this prompt
    return { kind: 'send', text: made.text, show, context: [...(e.context ?? []), 'Extra note from the user: ' + pick] }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'pp-up',
        description: 'Prompt Power Up: re | fix | off · auto | ask · eco | mid | full',
        argumentHint: '[re|fix|off] [auto|ask] [eco|mid|full] [min N] [model X|auto] [status]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('prompt-power-up: /pp-up not registered: ' + String(err), { to: 'debug' })
    }

    return next(e)
  })

  on('command.run', { command: 'pp-up' }, async ($, e) => {
    const s = withDefaults(await $.store.get('settings'))
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    let bad = ''

    // Each word sets its own dial, so `/pp-up fix mid ask` is one call.
    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? ''
      const w = word.toLowerCase()
      const nextWord = words[i + 1]
      if (w === 're' || w === 'rewrite') s.mode = 'rewrite'
      else if (w === 'fix' || w === 'off') s.mode = w
      else if (w === 'auto' || w === 'ask') s.flow = w
      else if (w === 'eco' || w === 'mid' || w === 'full') s.power = w
      else if (w === 'medium') s.power = 'mid'
      else if (w === 'min' && nextWord !== undefined && Number(nextWord) > 0) {
        s.minChars = clamp(Number(nextWord))
        i++
      } else if (w === 'model' && nextWord !== undefined) {
        s.modelOverride = nextWord
        i++
      } else if (w === 'tier' || w === 'status') continue
      else bad = word
    }
    if (bad) {
      return {
        text:
          `ไม่รู้จัก "${bad}" · Usage: /pp-up [re|fix|off] [auto|ask] [eco|mid|full] [min N] [model <name>|auto] [status]`,
      }
    }
    await $.store.set('settings', s)

    const tier = POWER[s.power]
    const model = s.modelOverride ?? tier.model
    const where = s.mode === 'fix' ? `อ่านบริบทย้อนหลัง ${tier.chars} ตัวอักษร · ` : ''
    return {
      text:
        s.mode === 'off'
          ? 'Prompt Power Up: off · เปิดด้วย /pp-up fix หรือ /pp-up re'
          : `Prompt Power Up: ${s.mode} · ${s.flow} · ${s.power} (${model}, effort ${tier.effort}) · ` +
            where +
            (s.mode === 'rewrite' ? `ทำงานกับ prompt ตั้งแต่ ${s.minChars} ตัวอักษรขึ้นไป` : 'ทำงานทุกความยาว') +
            `\nMode: re เรียบเรียงใหม่ทั้งประโยค | fix แก้คำผิดและตัดคำฟุ่มเฟือย คงประโยคเดิม | off ปิด` +
            `\nFlow: auto ส่งทันที | ask แสดงให้ตรวจก่อน` +
            `\nPower: eco haiku | mid sonnet | full opus — model แยกจากแชทหลัก (model auto เพื่อตามแชท)`,
    }
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const entry = shown.get(e.props.text.trim())
    if (!entry) return next(e)
    entry.isDrawn = true

    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    // The app shows the typed words when sent while idle and the rewrite when delivered mid-turn.
    // Name the text here so the row reads the same both ways: what was really sent.
    // Without the paste wrapper: Fix keeps it for Claude, and the person never typed it.
    const row = await next({ ...e, props: { ...e.props, text: forDisplay(entry.sent) } })
    // Dim and labelled like a log row, so it reads as the mod's and not as Claude's reply.
    return (
      <Box flexDirection="column" gap={1}>
        {row}
        <Box flexDirection="row" gap={2}>
          <Text dimColor>{LABEL}</Text>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Markdown text={blockOf(entry)} dimColor />
            <Box flexDirection="row" justifyContent="flex-end">
              <Button
                key="copy-original"
                label={COPY_ORIGINAL}
                plain
                dimColor
                onPress={press => void copyOriginal($, entry.original, press.surface)}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    // Only what the person sent themselves; slash commands are left alone
    if (e.command || e.isMeta || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)

    let action: Action = { kind: 'send', text: e.text }
    try {
      action = await decide($, e)
    } catch (err) {
      // Nothing this mod can fail at is worth holding the person's prompt for.
      $.ui.log('prompt-power-up: ' + String(err), { to: 'debug' })
    }
    if (action.kind === 'drop') return { drop: action.why }
    const { show } = action
    if (show) {
      // The row may already be drawn from the typed text, before this entry existed, and a repaint
      // reuses that answer. 0.2.4 left this out and never showed its boxes.
      $.ui.invalidate('ui.render')
      // No surface has to draw the row through this mod. Rather than lose the words, say them in a
      // log row if nothing drew the block by then.
      $.clock.after(BOX_WAIT_MS, () => {
        if (!show.isDrawn) $.ui.log(fallbackRow(show))
      })
    }
    return next(action.context ? { ...e, text: action.text, context: action.context } : { ...e, text: action.text })
  })
}
