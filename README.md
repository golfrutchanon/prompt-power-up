# ⚡ Prompt Power Up — mod สำหรับ Claude Code

แก้คำที่พูดเพี้ยน หรือเรียบเรียง prompt ที่วกวนให้ชัด ก่อน Claude จะอ่าน
*Corrects the words you dictated, or rewrites a rambling prompt, before Claude reads it.*

---

## ภาษาไทย

### สองโหมด เลือกอย่างใดอย่างหนึ่ง

**Mode `fix` — แก้เฉพาะคำผิด ประโยคเดิมอยู่ครบ**
เวลาพูดสั่ง AI คำอังกฤษมักออกมาเป็นไทยที่ไม่ใช่คำ (`เดพลอย` → `deploy`) หรือกลายเป็นคำอังกฤษผิดตัว
(`course` → `Claude`, `บราน` → `branch`) โหมดนี้แก้แค่คำพวกนั้น **ไม่เรียบเรียงประโยคใหม่** — พูด 5 คำได้ 5 คำ

mod ไม่ได้รับประโยคใหม่กลับมาจากโมเดล มันขอ**รายการคำแทน** `{from, to}` แล้วแทนให้เองในเครื่อง
คำที่ไม่มีอยู่จริงในข้อความ หรือกินเกินหนึ่งคำ จะถูกทิ้ง ประโยคของคุณจึงรอดโดยโครงสร้าง ไม่ใช่โดยการขอร้องโมเดล

โหมดนี้อ่านบทสนทนาที่ผ่านมาด้วย เพื่อรู้ว่าศัพท์ในวงสนทนาสะกดว่าอะไร — ทำงานได้ทุกความยาว

**Mode `rewrite` — เรียบเรียงใหม่ทั้งประโยค**
ตัดคำเติม (เอ่อ, แบบว่า, อะไรงี้) และคำซ้ำ เก็บเฉพาะสิ่งที่ตั้งใจจริง (พูดแก้ตัวเองก็เก็บอันสุดท้าย)
จัดเป็น เป้าหมาย / บริบท / เงื่อนไข / ผลลัพธ์ที่ต้องการ · ใช้ภาษาเดิมที่คุณพูด ศัพท์เทคนิค ชื่อไฟล์ คำสั่ง คงไว้
ไม่เพิ่มสิ่งที่คุณไม่ได้พูด · ทำงานกับ prompt ยาวตั้งแต่ 120 ตัวอักษรขึ้นไป (ปรับได้)

### Flow — จะให้ส่งเลย หรือให้ดูก่อน

| Flow | ผล |
|---|---|
| `auto` | ทำแล้วส่งทันที (ถ้าไม่มีอะไรต้องแก้ ก็ส่งของเดิมเฉยๆ) |
| `ask` | แสดงฉบับใหม่ใน transcript แล้วให้เลือก **ส่งฉบับนี้ / ตรวจใหม่ / ใช้ข้อความเดิม / กลับไปแก้** |

`ตรวจใหม่` สั่งให้ลองอีกรอบ ได้ถึง 3 รอบ

### Power — ความฉลาดของตัวตรวจ

| Power | โมเดล | effort | บริบทที่ `fix` อ่านย้อนหลัง |
|---|---|---|---|
| `eco` | Haiku | high | 2,000 ตัวอักษร · ย้อน 40 ข้อความ |
| `mid` | Sonnet | high | 6,000 ตัวอักษร · ย้อน 40 ข้อความ |
| `full` | Opus | high | 12,000 ตัวอักษร · ย้อน 60 ข้อความ |

**โมเดลของ mod แยกจากโมเดลที่คุณคุยแชทอยู่** คุยด้วย Opus แล้วให้ตรวจคำด้วย Haiku ได้ ไม่ต้องตรงกัน
(ถ้าอยากให้ตามแชท สั่ง `/power-up model auto`)

ทั้งสามระดับใช้ `effort: high` เหมือนกัน — ต่างกันที่คนตัดสิน ไม่ใช่ที่ความพยายาม

### บริบทที่ส่ง ไม่โตตามแชท

`fix` ประกอบบริบทขึ้นมาเองจากสองชั้น ไม่ได้ส่ง context window ทั้งก้อน:

1. **บัญชีคำ** — ดึงชื่อไฟล์ path ตัวระบุ และคำอังกฤษจากข้อความย้อนหลัง มา dedupe (ทำในเครื่อง ไม่เสีย token)
2. **เนื้อความล่าสุด** — ข้อความย้อนขึ้นไปจนเต็มงบตัวอักษรของ Power ที่เลือก

**ผลลัพธ์ของ tool ไม่ถูกส่งไปเลย** — ไฟล์ที่อ่าน ผล grep ผล bash ทั้งหมดถูกตัดออก มันกินงบหมดในท่อนเดียว
และไม่ได้ช่วยตัดสินว่าคำไหนเพี้ยน · แปลว่าแชทที่ใช้ context ไปแล้ว 90% เสียค่าตรวจคำเท่าแชทเปล่า

### ใช้ได้กับ voice input ทุกตัว
mod ทำงานกับ "ข้อความในช่องแชทตอนกดส่ง" ไม่สนว่าข้อความมาจากไหน ใช้ได้กับ:
พิมพ์เอง, วาง, voice input ของ Claude Code, macOS Dictation, MacWhisper, Wispr Flow, VoiceInk, superwhisper
หรือแอปแปลงเสียงที่คุณทำเอง ขอแค่แอปพิมพ์หรือวางข้อความลงช่องที่เคอร์เซอร์อยู่

คำสั่ง `/...` ไม่ถูกแตะ

### คำสั่ง
```
/power-up status              ดูการตั้งค่า
/power-up fix                 เปิดโหมดแก้คำผิด
/power-up rewrite             เปิดโหมดเรียบเรียงใหม่
/power-up off                 ปิด
/power-up auto                ส่งทันที
/power-up ask                 แสดงให้ตรวจก่อนส่ง
/power-up eco | mid | full    เลือกความฉลาด
/power-up min 200             ความยาวขั้นต่ำของโหมด rewrite
/power-up model sonnet        กำหนดโมเดลเอง (auto = ตามแชทหลัก)
```

ตั้งพร้อมกันได้ในคำสั่งเดียว: `/power-up fix mid ask`

### ค่าใช้จ่ายและความเป็นส่วนตัว
- ใช้บัญชี Claude ที่ login ใน Claude Code อยู่แล้ว ไม่ต้องมี API key แยก ไม่ส่งข้อมูลไปบริการอื่น
- การตรวจแต่ละครั้งนับเป็นการใช้งานของ plan หรือ API key ของคุณ · `eco` ถูกและเร็วที่สุด
- โหมด `fix` ส่งบทสนทนาย้อนหลังไปด้วยตามตารางข้างบน — ถ้าไม่อยากให้ส่ง ใช้ `rewrite` ซึ่งส่งแค่ prompt ที่พิมพ์
- mod รันด้วยสิทธิ์ของเครื่องคุณเหมือน mod ทุกตัว อ่านโค้ดได้ใน `hooks/register.ts` (ไฟล์เดียว)

### สำหรับคนทำแอปแปลงเสียง
ให้แอปใส่อักขระ U+2063 (INVISIBLE SEPARATOR มองไม่เห็น) ไว้หน้าข้อความที่วางลงช่องแชทได้
mod จะตัดอักขระนั้นออกให้ก่อนส่ง เพื่อไม่ให้มันไปถึงโมเดล

---

## English

### Two modes, pick one

**`fix` — corrects single words, leaves the sentence alone.** Dictated English comes out as Thai letters
that are not a word (`เดพลอย` → `deploy`) or as the wrong English word (`course` → `Claude`, `Brand` → `branch`).
This mode fixes those and nothing else: say five words, get five words.

It never takes a sentence back from the model. It asks for a list of `{from, to}` replacements and applies them
itself; a replacement naming text that is not in your message, or spanning more than one word, is dropped. Your
sentence survives by construction, not because the instructions asked nicely.

It reads the conversation so far to know how the terms in play are spelled, and runs at every prompt length.

**`rewrite` — restructures the whole prompt.** Fillers and repeats removed, only your final intent kept,
organised as Goal / Context / Requirements / Expected output, in the language you used, with nothing added.
Runs on prompts of 120+ characters (`/power-up min N`).

### Flow
`auto` sends it · `ask` shows it and offers **Send this / Check again / Keep original / Back to edit**
(Check again retries, up to 3 rounds).

### Power

| Power | model | effort | what `fix` reads back |
|---|---|---|---|
| `eco` | Haiku | high | 2,000 chars · 40 messages |
| `mid` | Sonnet | high | 6,000 chars · 40 messages |
| `full` | Opus | high | 12,000 chars · 60 messages |

**The mod's model is independent of the model your chat runs on** — chat on Opus, check words with Haiku.
`/power-up model auto` follows the chat instead. All three tiers use `effort: high`: the tiers differ by judge.

### The context it sends never grows with the chat
`fix` builds its own context from a term list (file names, paths, identifiers, English words — extracted locally,
no tokens) plus recent message text up to the tier's character budget. **Tool output is never sent**: file reads,
grep results and bash output are all excluded. A session 90% through its context window costs the same as an
empty one. It does not use `$.model.fork`, which would send the whole window and be locked to the chat's model.

### Works with any voice input
It reads the prompt box at submit time, so the text can come from typing, pasting, Claude Code's own voice input,
macOS Dictation, MacWhisper, Wispr Flow, VoiceInk, superwhisper, or your own dictation app. Slash commands are
left alone.

### Commands
```
/power-up status | fix | rewrite | off | auto | ask | eco | mid | full | min <chars> | model <name>|auto
```
Several at once: `/power-up fix mid ask`

### Cost and privacy
Uses your existing Claude Code login (no API key, no third-party service); each check counts toward your plan or
key, and `eco` is the cheapest. `fix` sends recent conversation as the table above describes — use `rewrite` if
you would rather send only the prompt you typed. Mods run with your permissions; the whole mod is one readable
file, `hooks/register.ts`.

---

## ติดตั้ง / Install

Claude Code v2.1.287 ขึ้นไป (ในแอป Claude Desktop แท็บ Code: v2.1.286 ขึ้นไป) / Claude Code v2.1.287+ (Desktop Code tab: v2.1.286+)

ในเทอร์มินัล ที่ prompt ของ Claude Code / At a Claude Code prompt in a terminal:
```
/plugin install prompt-power-up --marketplace golfrutchanon/prompt-power-up
```
จาก shell / From a shell:
```
claude plugin install prompt-power-up --marketplace golfrutchanon/prompt-power-up
```
ในแอป Claude Desktop: กด + ข้างช่องพิมพ์ → Plugins → Add marketplace ใส่ `golfrutchanon/prompt-power-up` → Add plugin
In the desktop app: click + next to the prompt box → Plugins → Add marketplace with `golfrutchanon/prompt-power-up` → Add plugin.

ตอบ `y` เพื่อเพิ่ม marketplace แล้วเลือก scope (user) / Answer `y` to add the marketplace, then pick a scope (user).

License: MIT
