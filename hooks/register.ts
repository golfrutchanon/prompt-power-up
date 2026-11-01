// Prompt Power Up — turn a long, rambling prompt into a clear "Super Power Prompt" before Claude reads it.
//
// It works on whatever is in the prompt box when Enter is pressed, so the text can come from typing,
// pasting, Claude Code's own voice input, or any dictation app that types into the focused field
// (macOS Dictation, MacWhisper, Wispr Flow, VoiceInk, superwhisper, your own app).
//
// When it runs (a prompt the user sent, not a slash command):
//   - the prompt starts with "++"            -> always power it up ("++" is removed)
//   - the prompt starts with "--"            -> never ("--" is removed, sent as is)
//   - the prompt starts with the app marker  -> always (a dictation app can prepend U+2063 or "🎙️")
//   - otherwise, in auto/ask mode, only prompts of at least `minChars` characters
// Mode: ask (show the new version, the user picks) | auto (send the new version) | off.
// The rewrite uses the session's own Claude login through $.model.complete: no API key, no outside service.
import type { Register } from 'claude-code'

type Mode = 'ask' | 'auto' | 'off'
type Settings = { mode: Mode; minChars: number; model: string }

const DEFAULTS: Settings = { mode: 'ask', minChars: 120, model: 'haiku' }
// What a dictation app can put in front of the text to say "this came from me, power it up":
// U+2063 (invisible separator, not shown) or the microphone emoji.
const APP_MARKERS = ['⁣', '🎙️', '🎙']
const USE_NEW = 'ใช้ฉบับ Power Up (Use Power Up)'
const KEEP = 'ใช้ข้อความเดิม (Keep original)'
const EDIT = 'กลับไปแก้ (Back to edit)'

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

const clamp = (n: number) => Math.max(20, Math.min(5000, Math.round(n)))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'power-up',
        description: 'Prompt Power Up: ask | auto | off | min <chars> | model <name> | status',
        argumentHint: '[ask|auto|off|min N|model haiku|status]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('prompt-power-up: /power-up not registered: ' + String(err), { to: 'debug' })
    }

    return next(e)
  })

  const withDefaults = (saved: unknown): Settings => ({ ...DEFAULTS, ...((saved as Partial<Settings> | undefined) ?? {}) })

  on('command.run', { command: 'power-up' }, async ($, e) => {
    const s = withDefaults(await $.store.get('settings'))
    const [word = 'status', value = ''] = e.args.trim().split(/\s+/)
    const cmd = word.toLowerCase()
    if (cmd === 'ask' || cmd === 'auto' || cmd === 'off') {
      s.mode = cmd
    } else if (cmd === 'min' && Number(value) > 0) {
      s.minChars = clamp(Number(value))
    } else if (cmd === 'model' && value) {
      s.model = value
    } else if (cmd !== 'status') {
      return { text: 'Usage: /power-up ask | auto | off | min <chars> | model <name> | status' }
    }
    await $.store.set('settings', s)

    return {
      text:
        `Prompt Power Up: mode ${s.mode}, prompts of ${s.minChars}+ characters, model ${s.model}. ` +
        `Start a prompt with ++ to always power it up, -- to skip.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only what the person sent themselves; slash commands are left alone
    if (e.command || e.isMeta || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)

    const s = withDefaults(await $.store.get('settings'))
    let text = e.text
    let forced = false

    if (text.startsWith('--')) return next({ ...e, text: text.slice(2).trimStart() })
    if (text.startsWith('++')) {
      text = text.slice(2).trimStart()
      forced = true
    }
    for (const m of APP_MARKERS) {
      if (text.startsWith(m)) {
        text = text.slice(m.length).trimStart()
        forced = true
      }
    }
    if (!text.trim()) return next({ ...e, text })
    if (!forced && (s.mode === 'off' || text.length < s.minChars)) return next({ ...e, text })

    $.ui.status('⚡ Power Up กำลังเรียบเรียง prompt…')
    const r = await $.model.complete({
      model: s.model,
      system: SYSTEM,
      prompt: text,
      maxTokens: 2000,
      timeoutMs: 30000,
    })
    $.ui.status(undefined)

    if (!r.isAnswered || !r.text.trim()) {
      $.ui.toast('Power Up ใช้ไม่ได้ตอนนี้ ส่งข้อความเดิมไป (could not rewrite, sent as is)')
      return next({ ...e, text })
    }
    const better = r.text.trim()

    if (s.mode === 'auto' && !forced) {
      $.ui.log('Power Up: rewrote your prompt (/power-up ask to review first)')
      return next({ ...e, text: better })
    }

    // Show the new version in the transcript (Claude doesn't read log lines), then let the person pick
    $.ui.log('⚡ Power Up version:\n\n' + better)
    let pick = KEEP
    try {
      pick = await $.ui.ask('ส่งฉบับ Power Up ไหม? (Send the Power Up version?)', {
        options: [USE_NEW, KEEP, EDIT],
        header: 'Power Up',
      })
    } catch {
      // dismissed, or a -p run with nobody to ask: send what they wrote
    }
    if (pick === EDIT) return { drop: 'กลับไปแก้ได้เลย ฉบับ Power Up อยู่ใน transcript ด้านบน (edit and send again)' }
    if (pick === USE_NEW) return next({ ...e, text: better })
    if (pick !== KEEP) {
      // typed under "Other": treat it as extra instructions for this prompt
      return next({ ...e, text: better, context: [...(e.context ?? []), 'Extra note from the user: ' + pick] })
    }

    return next({ ...e, text })
  })
}
