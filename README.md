# ⚡ Prompt Power Up — mod สำหรับ Claude Code

เปลี่ยนข้อความยาวๆ ที่พูดวกไปวนมา ให้เป็น "Super Power Prompt" ที่ชัดเจน ก่อน Claude จะอ่าน
*Turns long, rambling prompts into a clear "Super Power Prompt" before Claude reads them.*

---

## ภาษาไทย

### ทำอะไร
เวลาพูดสั่ง AI ยาวๆ ผ่านไมค์ ข้อความมักมีคำเติม (เอ่อ, แบบว่า, อะไรงี้) ศัพท์ไทยปนอังกฤษ ความคิดสลับไปมา
mod นี้ดักข้อความตอนคุณกด Enter แล้วให้ Claude (โมเดลเล็ก Haiku) เรียบเรียงใหม่:
- ตัดคำเติมและคำซ้ำ เก็บเฉพาะสิ่งที่ตั้งใจจริง (พูดแก้ตัวเองก็เก็บอันสุดท้าย)
- จัดเป็น เป้าหมาย / บริบท / เงื่อนไข / ผลลัพธ์ที่ต้องการ (คำขอสั้นๆ ก็ยังสั้น)
- ใช้ภาษาเดิมที่คุณพูด ไทยยังเป็นไทย ศัพท์เทคนิค ชื่อไฟล์ และคำสั่งคงไว้ตามเดิม
- ไม่เพิ่มสิ่งที่คุณไม่ได้พูด

แล้วถามคุณก่อนส่งว่าจะใช้ฉบับไหน: **ใช้ฉบับ Power Up / ใช้ข้อความเดิม / กลับไปแก้**
(ฉบับ Power Up แสดงใน transcript ให้อ่านก่อนเลือก)

### ใช้ได้กับ voice input ทุกตัว
mod ทำงานกับ "ข้อความในช่องแชทตอนกดส่ง" ไม่สนว่าข้อความมาจากไหน ใช้ได้กับ:
พิมพ์เอง, วาง, voice input ของ Claude Code, macOS Dictation, MacWhisper, Wispr Flow, VoiceInk, superwhisper
หรือแอปแปลงเสียงที่คุณทำเอง ขอแค่แอปพิมพ์หรือวางข้อความลงช่องที่เคอร์เซอร์อยู่

### เมื่อไหร่ถึงทำงาน
| ข้อความ | ผล |
|---|---|
| ยาวตั้งแต่ 120 ตัวอักษร (ปรับได้) | Power Up |
| ขึ้นต้นด้วย `++` | Power Up เสมอ (ตัด `++` ออก) |
| ขึ้นต้นด้วย `--` | ส่งตามเดิม (ตัด `--` ออก) |
| ขึ้นต้นด้วยป้ายจากแอปพูด (U+2063 หรือ 🎙️) | Power Up เสมอ |
| คำสั่ง `/...` | ไม่แตะ |

### คำสั่ง
```
/power-up status        ดูการตั้งค่า
/power-up ask           ถามก่อนส่งทุกครั้ง (ค่าเริ่มต้น)
/power-up auto          เรียบเรียงแล้วส่งเลย ไม่ถาม
/power-up off           ปิด (ยังใช้ ++ ได้)
/power-up min 200       เปลี่ยนความยาวขั้นต่ำ
/power-up model sonnet  เปลี่ยนโมเดลที่ใช้เรียบเรียง (ค่าเริ่มต้น haiku)
```

### ค่าใช้จ่ายและความเป็นส่วนตัว
- ใช้บัญชี Claude ที่ login ใน Claude Code อยู่แล้ว ไม่ต้องมี API key แยก ไม่ส่งข้อมูลไปบริการอื่น
- การเรียบเรียงแต่ละครั้งนับเป็นการใช้งานของ plan หรือ API key ของคุณ (Haiku ถูกและเร็ว)
- mod รันด้วยสิทธิ์ของเครื่องคุณเหมือน mod ทุกตัว อ่านโค้ดได้ใน `hooks/register.ts` (ไฟล์เดียว)

### สำหรับคนทำแอปแปลงเสียง
ให้แอปใส่อักขระ U+2063 (INVISIBLE SEPARATOR มองไม่เห็น) ไว้หน้าข้อความที่วางลงช่องแชท
mod จะรู้ว่าข้อความมาจากแอปคุณและ Power Up ให้ทุกครั้ง ไม่ต้องรอให้ยาวถึงเกณฑ์

---

## English

### What it does
Dictated prompts are full of fillers, Thai/English mixed terms and ideas out of order. When you press Enter, this mod has
Claude (Haiku) rewrite the prompt: fillers and repeats removed, only your final intent kept, organised as
Goal / Context / Requirements / Expected output, in the language you used, with nothing added. Then it asks:
**Use Power Up / Keep original / Back to edit** (the Power Up version is shown in the transcript first).

### Works with any voice input
It reads the prompt box at submit time, so the text can come from typing, pasting, Claude Code's own voice input,
macOS Dictation, MacWhisper, Wispr Flow, VoiceInk, superwhisper, or your own dictation app.

### When it runs
- prompts of 120+ characters (`/power-up min N` to change)
- `++` at the start: always (removed) · `--` at the start: never (removed)
- U+2063 or 🎙️ at the start (a dictation app's marker): always · slash commands: never

### Commands
`/power-up status | ask | auto | off | min <chars> | model <name>`

### Cost and privacy
Uses your existing Claude Code login (no API key, no third-party service); each rewrite counts toward your plan or key.
Mods run with your permissions; the whole mod is one readable file, `hooks/register.ts`.

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
