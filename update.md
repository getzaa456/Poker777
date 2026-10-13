# Poker777 — สรุปการแก้ไข และสิ่งที่ควรทำต่อ

อัปเดตล่าสุด: **6 ต.ค. 2026** • branch `AlmostDone` (ต่อจาก commit `517e1cb`)

หลักที่ใช้ตลอด: **แก้ Frontend ได้เต็มที่ / แตะ Backend เฉพาะบัคจริงหรือฟีเจอร์ที่ทีมขอ** — ทุกจุดที่แก้ใน Backend มีคอมเมนต์ `[แก้บัค]` กำกับ ค้นหาได้ด้วย

```bash
grep -rn "แก้บัค" backend/src
```

## สรุปสั้น (TL;DR)

- **เงิน:** แก้บัคนับกำไร/ขาดทุนซ้ำทุกมือแล้ว — แต่ **ยังไม่มี Escrow** (เอาเงินก้อนเดียวไปนั่งหลายโต๊ะได้) → ข้อที่ควรทำอันดับ 1
- **เกม:** หน้าโต๊ะเล่นได้ครบ, Reconnect, Auto start, ป้าย Action/ผู้ชนะ, ช่อง Bet แบบพิมพ์ได้, Responsive ทุกขนาดจอ, โต๊ะ 9 คน
- **เว็บจริง (poker777.club) ยังเป็นโค้ดเก่า** — ต้อง build/deploy ใหม่จาก `AlmostDone` และ **ต้องรัน migrate** ก่อน (มีคอลัมน์ใหม่ `tables.bet_step`)
- โหลด 50 ผู้เล่นพร้อมกันบน Server เครื่องเดียว: เวลาตอบสนอง ~2 ms, RAM ~200 MB — สบาย

## สารบัญ
1. [Backend — บัคที่แก้](#1-backend--บัคที่แก้)
2. [Frontend](#2-frontend)
3. [Deploy และเครื่องมือ](#3-deploy-และเครื่องมือ)
4. [การทดสอบ](#4-การทดสอบ)
5. [สถานะปัญหาที่เคยรายงาน](#5-สถานะปัญหาที่เคยรายงาน)
6. [สิ่งที่ควรทำต่อ](#6-สิ่งที่ควรทำต่อ)

---

## 1. Backend — บัคที่แก้

| # | ไฟล์ | บัค | ผลกระทบ | วิธีแก้ |
|---|---|---|---|---|
| 1 | `services/tables.js` | `roomNotFoundError()` ถูกคอมเมนต์ทิ้งแต่ยังถูกเรียก | ใส่รหัสห้องผิด → Server ตอบ 500 แทน 404 | เปิดฟังก์ชันกลับมา |
| 2 | `services/tables.js` | นับที่นั่งจาก `table:{id}:seats` ซึ่งไม่มีใครเขียน | หน้า Rooms แสดง 0 คนเสมอ, เช็คห้องเต็มผ่าน REST ไม่ทำงาน | นับจาก `room:{room_code}:seats` |
| 3 | `ws/ws-server.js` | Sync เงินเทียบกับ `buyIn` ตั้งต้นทุกมือ แต่ `buyIn` ไม่เคยขยับ | **เงินผิด:** กำไร/ขาดทุนมือก่อนถูกนับซ้ำทุกมือ | หลัง Settle ตั้ง `buyIn = chips` ปัจจุบัน (`resetSettlementBaseline`) |
| 4 | `services/lockService.js` | ขอ Lock ไม่ได้ throw ทันที | Action ชนกันแล้วหาย, การหลุดเน็ตที่ชนงานอื่นหาย → ที่นั่งผี | รอแล้วลองใหม่ ~2 วินาที |
| 5 | `ws/ws-server.js` | Timer เปลี่ยน Turn แต่ไม่อัปเดต `currentTurnSeat` | คนที่หมดเวลากดออก → ข้าม Turn คนถัดไป | อัปเดต `currentTurnSeat` ด้วย |
| 6 | `services/roomService.js` | คนที่ถือ Turn ออก → นับคนถัดไปจาก index 0 | ลำดับ Turn ผิด | นับต่อจากเก้าอี้ของคนที่ออก |
| 7 | `ws/ws-server.js` | ตอนคนออก ส่งแค่ `next_turn` | Client ไม่เห็นไพ่กลางใหม่ / Host ใหม่ | ส่ง Snapshot โต๊ะหลังมีคนออก |
| 8 | `ws/ws-server.js` | ไม่มี WebSocket Heartbeat | เน็ตค้างแบบ Half-open → ผู้เล่นไม่ถูกลุก โดน Auto-fold ทุกมือ; ALB ตัด Connection idle 60 วิ | Ping ทุก 15 วิ ไม่ตอบ → ตัด → เข้า Reconnect grace |
| 9 | `ws/ws-server.js` | Host = คนที่ต่อ WebSocket คนแรก ไม่ใช่คนสร้างห้อง | เพื่อนเข้าก่อนได้ปุ่ม START | เก็บ `creatorId` — *ภายหลังเพื่อนปรับให้ปุ่ม START เช็คจาก `tables.host_id` ในฐานข้อมูลโดยตรง* |
| 10 | `ws/ws-server.js` | ห้ามนั่งระหว่างมือ ("Table is already in progress") | พอมี Auto start มือเริ่มต่อกันแทบตลอด → คนใหม่แทบนั่งไม่ได้ | นั่งได้เลย นับเป็น "หมอบ" ในมือที่เล่นอยู่ ได้ไพ่มือถัดไป |
| 11 | `ws/ws-server.js` | มือที่จบเพราะคนอื่นหมอบหมด **ไม่ถูกบันทึก** ลง `hand_results` | Win rate / สถิติในโปรไฟล์เพี้ยน (นับแค่มือ Showdown) | อ่านไพ่ก่อน `resetRoundState` ลบทิ้ง |

**ฟีเจอร์ฝั่ง Backend ที่เพิ่ม (ตามที่ทีมขอ)**
- **Auto start** (`ws/ws-server.js`): มือแรกเริ่มเอง 10 วิหลังมีผู้เล่นที่มีชิป ≥ 2 คน, มือถัดไปเริ่มเอง 6 วิหลังจบมือ — ใช้ Redis sorted set + lock จึงทำงานถูกเมื่อมีหลาย EC2; ตั้งด้วย env `AUTO_START_DELAY_MS` (`0` = ปิด); คนสร้างห้องกด START NOW ได้; ส่ง `next_hand_at` ให้หน้าเว็บนับถอยหลัง; โค้ดเริ่มมือแยกเป็นฟังก์ชัน `startHand()` ใช้ร่วมกับปุ่ม START
- **Bet step ต่อห้อง:** คอลัมน์ใหม่ `tables.bet_step` (ค่าเริ่มต้น 20) — `schema.sql`, `validators/tables.js`, `services/tables.js`; `scripts/migrate.js` เพิ่มคอลัมน์ให้ฐานข้อมูลที่มีอยู่แล้วอัตโนมัติ (เช็คจาก `information_schema`)
- **ใช้ RDS Read Replica (6 ต.ค.)** — เดิมมี endpoint เดียว (Primary) ทุก query วิ่งไป Primary ทั้งที่ Terraform สร้าง Replica ไว้ 3 ตัว
  - `config/db.js`: `pool` = Primary (เหมือนเดิม) + `readPool` ใหม่ กระจาย query ไปทุก Replica แบบวนรอบ (RDS MySQL ไม่ใช่ Aurora — Replica แต่ละตัวมี endpoint ของตัวเอง ไม่มี reader endpoint กลาง)
  - ส่งไป Replica **เฉพาะ** query อ่านอย่างเดียวที่ช้าไปเสี้ยววินาทีได้: รายการห้อง (`listOpenTables`), ประวัติธุรกรรม (`getTransactions`), ประวัติ/สถิติการเล่น (`getHandHistory`) — ยอดเงิน, Login, ห้องที่เพิ่งสร้าง, การเขียนทุกอย่าง ยังใช้ Primary (Replica อาจตามหลังเล็กน้อย = replication lag)
  - Replica ล่ม/ต่อไม่ได้ → อ่านจาก Primary แทนอัตโนมัติ (log `[db] read replica unavailable`)
  - ตั้งค่า: env `DB_READ_HOSTS=replica1,replica2,replica3` (คั่นด้วยจุลภาค; ไม่ตั้ง = ใช้ Primary อย่างเดียวเหมือนเดิม) — Terraform ใส่ให้อัตโนมัติจาก `aws_db_instance.reader[*].address` (`compute.tf` + `backend-user-data.sh.tftpl`); ถ้าใช้ `backend/ec2-user-data.sh` ให้เพิ่ม key `DB_READ_HOSTS` ใน Secret เอง; log ตอนเปิด Server บอกจำนวน (`readReplicas=3`)
  - ทดสอบ: ยอดเงินอ่านจาก Primary ✓, รายการ/ประวัติกระจายไป replica-a / replica-b ✓, replica ที่ล่มถอยไป Primary ✓, ไม่ตั้งค่า → ทำงานเหมือนเดิม ✓

### ลบห้องร้าง `[แก้บัค]` (7 ต.ค.)

- **บัค:** กด Create room แล้วไม่ได้นั่ง (กด Back to lobby เลย) ห้องค้างในรายการ Open Rooms ตลอดไป — เดิมห้องถูกลบเฉพาะตอน "คนสุดท้ายลุก" แต่ห้องนี้ไม่เคยมีคนนั่ง
- **แก้:** `sweepEmptyRooms()` ใน `ws-server.js` ทุก 30 วิ หาห้องที่สร้างมาเกิน **2 นาที** และไม่มีใครนั่ง (`room:{code}:seats` ว่าง) แล้วลบทิ้งทั้งใน DB และ Redis (ใช้ `deleteRoom()` ตัวเดิม) ทำใต้ `withLock` เดียวกับตอน join จะได้ไม่ลบห้องที่มีคนกำลังนั่งพอดี
- 2 นาทีคือเวลาให้เจ้าของห้องเลือก Buy-in / ส่งรหัสให้เพื่อน ปรับได้ด้วย env `EMPTY_ROOM_GRACE_MS` (ไม่บังคับ, ค่าเริ่ม `120000`, ต่ำสุด `30000`)
- ห้องที่มีคนนั่ง (รวมคนที่หลุดและอยู่ในช่วงรอ Reconnect 30 วิ) ไม่ถูกลบ
- ทดสอบ: ห้องว่างหายจากรายการ ✓, ห้องที่มีคนนั่งอยู่ไม่หาย ✓, กด Join ห้องที่ถูกลบ → 404 Room not found ✓

ไฟล์อื่น: `backend/.dockerignore` — กัน `node_modules` ของ Windows ถูก COPY เข้า Docker image

---

## 2. Frontend

### 2.1 หน้าโต๊ะ — เขียนใหม่ให้ตรงกับ Protocol ของ Backend
หน้าเดิมเล่นจริงไม่ได้เลย:

| ปัญหาเดิม | แก้เป็น |
|---|---|
| ส่ง `START_GAME` / `GAME_ACTION` / `LEAVE_ROOM` แต่ Backend รับ `start-game` / `game-action` / `leave-room` | ส่งชื่อที่ Backend รับ |
| รอฟัง `TABLE_STATE` แต่ Backend ส่ง `table_state` และ Event ทีละอย่าง | รองรับทั้ง Snapshot และ Event ทุกตัว (reducer เดียว) |
| เลขที่นั่งเพี้ยน 1 ช่อง | แปลงเป็นเริ่มที่ 0 |
| ไพ่ 10 แสดงเป็น `T` และคำนวณมือผิด | แปลง `T` → `10` |
| BET/RAISE ใช้ผิดจังหวะ, CHECK/CALL กดได้ตลอด | สลับอัตโนมัติ, CALL บอกยอด, บังคับ Min raise, ปุ่ม ALL IN |
| Buy-in = ขั้นต่ำเสมอ | หน้าต่าง **Take a seat** เลือก Buy-in ด้วยแถบเลื่อน |
| เห็นตัวเองซ้ำบนโต๊ะ | ตัวเองอยู่แผงด้านล่างอย่างเดียว |
| วงนับเวลาค้างที่ 70% | ลดลงตามเวลาจริง 15 วิ, 5 วิสุดท้ายเป็นสีแดง |

### 2.2 Reconnect / เน็ตไม่เสถียร
| สถานการณ์ | พฤติกรรม |
|---|---|
| Refresh หรือเน็ตหลุด < 30 วิ | กลับมาที่เดิม ไพ่เดิม ชิปเดิม + แจ้ง "Reconnected" |
| หลุด > 30 วิ | แจ้งว่าหลุดนานเกินไป ชิปคืน Wallet แล้ว ให้เลือก Buy-in ใหม่ (เดิมนั่งใหม่เงียบๆ พร้อมหัก Buy-in) |
| เน็ตค้างแบบ Half-open | Watchdog ต่อใหม่เอง, Timeout การเชื่อมต่อ 8 วิ, ฟัง online/offline ของ Browser |
| ระหว่างหลุด | แถบเหลือง "Connection lost — reconnecting…" |
| ยอด Bet หลัง Reconnect | ของตัวเองถูกต้อง, ของคนอื่นซ่อนจนรอบถัดไป (กันแสดงค่าเก่า) |

### 2.3 เสียงเอฟเฟกต์ (`frontend/src/lib/sound.js`)
สร้างด้วย Web Audio API ไม่มีไฟล์เสียง/ไม่มีปัญหาลิขสิทธิ์ — แจกไพ่, ลงชิป, All-in, Check, Fold, ถึงตาเรา, นับถอยหลัง, คนเข้า/ออก, ชนะ/แพ้ — ปุ่ม 🔊/🔇 (จำค่าไว้)

### 2.4 Lobby / Rooms
- ปุ่ม Join / Enter Table เดิมพาไป `/test.html` ซึ่งไม่ถูก build → เปลี่ยนเป็น `/poker-table`
- ป้าย "Blinds min/max" → **"Buy-in min – max"** (Blinds มาจาก `.env`: `POKER_SMALL_BLIND` / `POKER_BIG_BLIND`, ค่าเริ่มต้น 10/20)

### 2.5 Login / Register ไม่แจ้ง Error
ต้นเหตุ: `index.css` ตั้ง `.form-error { display: none; }` ข้อความจึงถูกซ่อนตลอด
- แถบ Error + กรอบแดงและข้อความใต้ช่องที่ผิด, ตรวจก่อนส่งด้วยกฎเดียวกับ `validators/auth.js`
- แปล Error จาก Server: รหัส/ชื่อผิด, Username/Email ซ้ำ, ลองบ่อยเกิน, ต่อ Server ไม่ได้
- ฟอร์มยาวบนจอเตี้ยเลื่อนลงได้ (เดิมปุ่ม Register หลุดจอกดไม่ได้)
- ตอน Login ผิดบอกรวมๆ ว่า "username/email หรือรหัสผ่านไม่ถูกต้อง" — ตั้งใจเพื่อความปลอดภัย

### 2.6 UX/UI + Responsive
ต้นเหตุ: ทุกอย่างวางด้วย `position:absolute` ขนาด px ตายตัว
- หน้าโต๊ะเป็น 3 แถว (Header / โต๊ะ / Dock ล่าง) — โต๊ะย่อ-ขยายตามพื้นที่ (CSS container query) หน้าพอดีจอ
- ที่นั่งเรียงเป็นวงรอบโต๊ะตามลำดับ Turn **เราอยู่ล่างสุดเสมอ**; โต๊ะเต็ม 9 คนบนมือถือ ที่นั่งย่อและวงแคบลงอัตโนมัติ
- ข้อความแจ้งเตือนย้ายไปแถว Header ไม่บังผู้เล่น
- ปุ่ม Action โชว์เฉพาะระหว่างมือ; ไพ่จางเมื่อ Fold; ชิป Dealer ที่ Avatar
- Lobby บนมือถือ: แถบโปรไฟล์ไม่ล้นจอ

### 2.7 ฟีเจอร์ตามลิสต์ของเพื่อน (5 ต.ค.)

| ที่ขอ | ทำแล้ว |
|---|---|
| แสดง action ของผู้เล่นแต่ละคน และผู้ชนะแต่ละรอบให้ชัด | ป้ายเหนือชื่อทุกที่นั่ง `SB 10` `BB 20` `CALL 20` `RAISE 120` `ALL IN 500` `FOLD` (สีตามประเภท, ⏱ = หมดเวลา) • ป้ายผู้ชนะกลางโต๊ะ "🏆 X won 280 with Full House" + `+280` ที่ที่นั่ง • ไพ่ที่เปิดตอน Showdown ค้างไว้จนมือใหม่ |
| ปุ่ม START บังแถบผู้เล่น (จอเล็ก) | แยกแถวแล้ว — วัดกล่องที่ 390 / 768 / 1024 / 1366 / 1872 px ไม่มีอะไรทับ |
| แถบผู้เล่นตรงกลางโดนแถบตัวเองทับ | ที่นั่งเป็นวงรอบโต๊ะ เราอยู่ล่างสุด — ทดสอบโต๊ะเต็ม 9 คนทุกขนาดจอ |
| auto start | นับถอยหลัง "Next hand starts in 6s" / ปุ่ม "START NOW · auto in 6s" (ดู Backend ด้านบน) |
| โปรไฟล์ส่วนบนที่แสดง winrate | แถบใต้ชื่อ = Win rate จริง • Lv. / ฉายา (Rookie → Regular / Shark / Challenger → Legend) จากสถิติจริง |
| bet พิมพ์จำนวนเองได้ | ช่องพิมพ์ + ปุ่ม Min / ½ Pot / Pot • มีคำเตือนเมื่อต่ำกว่าขั้นต่ำหรือเกินชิปที่มี |
| ปุ่ม +/− เด้งกลับ | บวก/ลบต่อจากค่าปัจจุบัน ไม่รีเซ็ตเมื่อคนอื่น action |
| ตั้งตอนสร้างห้องว่า +/− ทีละเท่าไร | ช่อง **Bet step** ในหน้าสร้างห้อง (10/20/50/100 หรือพิมพ์เอง) |

> **กติกา:** No-Limit Hold'em บังคับว่า Raise ต้องเพิ่มอย่างน้อยเท่ากับการ Bet/Raise ครั้งก่อน — มีคน Bet 180 → Raise ขั้นต่ำคือ **360** ไม่ใช่ 200 ปุ่ม + จึงเริ่มจากขั้นต่ำที่ถูกกติกา (Server ก็บังคับแบบนี้)

### 2.8 เปิดไพ่กลางทีละใบ (7 ต.ค. — Frontend อย่างเดียว)

เดิมไพ่ Flop 3 ใบโผล่พร้อมกัน และตอน All-in ไพ่ 5 ใบ + ผู้ชนะโผล่ทันทีในครั้งเดียว ตอนนี้:

- ไพ่กลางพลิกขึ้น **ทีละใบ ห่างกัน 0.65 วินาที** (`CARD_REVEAL_MS` ใน `PokerTablePage.jsx`) พร้อมเสียงไพ่ทีละใบ
- ตอน All-in ที่ต้องเปิดไพ่ที่เหลือจนจบ: เปิดทีละใบจนครบ 5 ใบ **แล้วค่อย**โชว์ไพ่คู่แข่ง, ป้าย 🏆, `+เงิน`, ข้อความ/เสียงผู้ชนะ ระหว่างนั้นกองกลางและชิปยังเป็นค่าก่อนจ่าย (ไม่สปอยล์)
- ปุ่ม Action รอให้ไพ่ของรอบใหม่เปิดครบก่อนค่อยกดได้ (ประมาณ 1 วินาทีตอน Flop) จะได้ไม่เผลอกดก่อนเห็นไพ่
- เข้าห้องใหม่ / Reconnect กลางมือ: ไพ่ที่อยู่บนโต๊ะแล้วโชว์เลย ไม่เล่นซ้ำ

> ถ้าเปิด Auto start ไว้ (ค่าเริ่ม 6 วิ) ตอน All-in ตั้งแต่ Preflop การเปิดไพ่ใช้ ~3 วิ จะเหลือเวลาดูผลประมาณ 3 วิ — ถ้าอยากให้นานขึ้น เพิ่ม `AUTO_START_DELAY_MS` เป็น `9000` ใน Secrets Manager ได้ (ไม่บังคับ)

### 2.9 เหรียญหมด → ดูคลิป Rickroll → เลือกกล่องสุ่ม (12 ต.ค.) `[เพิ่มฟีเจอร์]`

ปุ่ม **Free** (ไอคอนกล่องของขวัญ) มุมบนข้างชื่อผู้เล่น ในหน้า Lobby (กระพริบเมื่อรับได้) → ดูคลิป Rickroll 10 วิ → กล่อง 3 ใบขึ้นมา → เลือก 1 ใบ → เฉลยว่าได้เท่าไร พร้อมเปิดอีก 2 กล่องให้ดูว่าพลาดอะไรไป

**ไฟล์:** `backend/src/services/reward.js` (ใหม่), `backend/src/routes/wallet.js`, `backend/src/config/env.js`, `frontend/src/components/RewardModal.jsx` (ใหม่), `frontend/src/lib/api.js`, `frontend/src/pages/LobbyPage.jsx`, `frontend/public/assets/css/lobby.css`

**API:** `GET /wallet/reward` (สถานะ) • `POST /wallet/reward/start` • `POST /wallet/reward/claim` `{ session_id, box: 0|1|2 }`

**กันโกง — Server ตัดสินทุกอย่าง หน้าเว็บแค่แสดงผล:**

| ช่องโหว่ที่กัน | ทำยังไง |
|---|---|
| ข้ามคลิป / ยิง API ตรง | Server จดเวลาตอน `start` ไว้ใน Redis — `claim` ก่อนครบ 10 วิ ได้ `425 REWARD_TOO_EARLY` |
| แอบดูรางวัลก่อนเลือก | สุ่มรางวัลด้วย `crypto.randomInt` ตอน `start` แล้วเก็บใน Redis เท่านั้น ไม่ส่งให้หน้าเว็บจนกว่าจะเลือกแล้ว |
| กด start ซ้ำเพื่อสุ่มใหม่ / รีเซ็ตเวลา | มี session ค้างอยู่ → คืนอันเดิม (ไม่สุ่มใหม่ ไม่รีเซ็ตเวลา) |
| ยิง claim พร้อมกันหลายครั้ง / ใช้ session ซ้ำ | session ใช้ได้ครั้งเดียว (ลบ key แล้วเช็คว่าลบได้จริง) + `ref_id = reward:{session}` UNIQUE ใน transactions อีกชั้น — ทดสอบยิงพร้อมกัน 8 ครั้ง ได้เงินครั้งเดียว |
| ใช้ session ของคนอื่น | session ผูกกับ user ใน token |
| ส่ง box แปลกๆ (`3`, `-1`, `"1"`, `1.5`, `null`) | รับเฉพาะเลขจำนวนเต็ม 0–2 → `400` |
| ปั๊มเหรียญ | รับได้เฉพาะเงินใน Wallet < 100, Cooldown 5 นาที, วันละ 5 ครั้ง |

ฝั่งหน้าเว็บนับเวลาเฉพาะตอนคลิป **กำลังเล่นจริง + อยู่ในแท็บ** (YouTube IFrame API) กดหยุด/สลับแท็บ = หยุดนับ — ส่วนนี้คนเปิด DevTools ข้ามได้ แต่ไม่ได้อะไรเพราะ Server ยังบังคับเวลาอยู่

**แก้ (13 ต.ค.) — โฆษณาของ YouTube กดข้ามไม่ได้:** คลิป Rickroll ทางการเจ้าของเปิดรับโฆษณา YouTube จึงแทรกโฆษณาก่อนคลิป (เราห้ามไม่ได้) แต่ CSS ตั้ง `pointer-events:none` ไว้ที่ iframe → ปุ่ม "Skip Ad" กดไม่ได้ และตัวนับไม่นับช่วงโฆษณา → ต้องดูโฆษณาจบ + 10 วิ • แก้: iframe กดได้ (`lobby.css`), เปิด `controls: 1`, **นับเวลาช่วงโฆษณาด้วย** (สถานะ unstarted/buffering/playing — หยุดนับเฉพาะตอนกด pause หรือสลับแท็บ) และขึ้นข้อความ "YouTube ads count too" (`RewardModal.jsx`) — Server ไม่ได้แก้ ยังบังคับ 10 วิเหมือนเดิม

รางวัลต่อกล่อง (แก้ใน `PRIZES` ของ `reward.js`): 100 (35%) • 300 (30%) • 500 (20%) • 1,000 (12%) • 3,000 (3%) — บันทึกเป็นธุรกรรม `BONUS` (ไม่ต้องแก้ Schema / ไม่ต้อง migrate)

**env ใหม่ (ไม่บังคับทั้งหมด):** `REWARD_WATCH_SECONDS=10`, `REWARD_MAX_BALANCE=100`, `REWARD_COOLDOWN_SECONDS=300`, `REWARD_DAILY_LIMIT=5`

> ปุ่ม Top Up (เสกเหรียญฟรีได้ไม่จำกัด) ถูกลบแล้วในข้อ 2.11 — ตอนนี้เหรียญฟรีมาจากกล่องสุ่มนี้ทางเดียว

### 2.10 เลิกใช้ Emoji + แก้ช่องอีเมลตอนสมัคร (12 ต.ค.)

- **Emoji → ไอคอนเส้น SVG** (`frontend/src/components/Icon.jsx`) สีตามตัวอักษร ดูเป็นงานออกแบบมากกว่า: เหรียญ, ของขวัญ, ถ้วยรางวัล, ลำโพง/ปิดเสียง, เตือน, ตา (แสดง/ซ่อนรหัสผ่าน — สลับไอคอนตามสถานะ), ค้นหา, คน, กุญแจ ใน Lobby / Rooms / Login / โต๊ะ / กล่องสุ่ม • ประวัติธุรกรรมเป็นข้อความล้วน • ป้ายหมดเวลาเป็น `FOLD · TIMEOUT` • ยังเก็บ ♠♥♦♣ (สัญลักษณ์ไพ่) และ ✕ ปุ่มปิด
- **อีเมลถูกปัดตก "Invalid email format":** หน้าเว็บเช็คอีเมลหลวมกว่า Server (ยอมให้ตัวอักษรไทย/ช่องว่างผ่าน) แล้ว Server ปฏิเสธด้วยข้อความกว้างๆ — ตอนนี้หน้าเว็บใช้ pattern เดียวกับ zod ฝั่ง Server และบอกชัดว่า "ใช้ได้แค่ตัวอังกฤษ/ตัวเลข — เช็คว่าแป้นพิมพ์ไม่ได้เป็นภาษาไทยและไม่มีช่องว่าง" (อีเมล `@kmitl.ac.th` ปกติผ่านทั้งสองฝั่ง)

### 2.11 ลบ Top Up + เพิ่ม Motion (12 ต.ค.)

**ลบ Top Up `[แก้บัค]`** — เดิมกดเติมเหรียญฟรีได้ครั้งละ 100,000 ไม่จำกัดครั้ง ทำให้เงินในเกมไม่มีความหมาย
- Backend: ลบ `POST /wallet/topup` (route + `topUp()` ใน `services/wallet.js` + `topupSchema`) → ตอนนี้ตอบ `404` • ลบ env `TOPUP_MIN` / `TOPUP_MAX` (ใน Secret ถ้ามีก็ปล่อยไว้ได้ ไม่มีผล)
- Frontend: ลบปุ่ม/หน้าต่าง Top Up • ปุ่มในแผงโปรไฟล์เปลี่ยนเป็น **Free Chips** (เปิดกล่องสุ่ม)
- เทส `wallet.test.js`: เทส topup เดิมเปลี่ยนเป็น "topup ต้องได้ 404 และเงินไม่เพิ่ม" • เทสรายการธุรกรรมสร้างข้อมูลผ่าน `/internal/wallet/adjust` แทน • ลบเทส "50 parallel topups" (มีเทสพร้อมกันของ adjust อยู่แล้ว)
- ธุรกรรม `TOPUP` เก่าใน DB ยังแสดงในประวัติได้ตามเดิม (ไม่แก้ Schema)

**Motion** — ทุกอย่างเล่นครั้งเดียวตามเหตุการณ์ในเกม 0.3–0.7 วิ ไม่มีอะไรวนไม่หยุด และปิดเองถ้าเครื่องผู้ใช้ตั้ง "ลดการเคลื่อนไหว" (`prefers-reduced-motion`)

| ที่ | Motion |
|---|---|
| โต๊ะ | ชิปลอยจากที่นั่งคนลงเงินเข้ากองกลาง (All-in ลอยเยอะกว่า) และจากกองกลางไปหาผู้ชนะ • ตัวเลขชิป/กองกลางไหลไปค่าใหม่แทนกระโดด (กองกลางเด้งตอนเพิ่ม) • ไพ่ในมือเราสไลด์มาจากกลางโต๊ะทีละใบ • ที่นั่งผู้ชนะเรืองแสง 3 จังหวะ • ป้ายผู้ชนะมีแสงกวาดผ่าน • ป้าย YOUR TURN เด้งขึ้น • ปุ่ม Action ไล่ขึ้นมาตอนเริ่มมือ และยุบเล็กน้อยตอนกด |
| Lobby | ส่วนต่างๆ ไล่ลอยขึ้นตอนเปิดหน้า • หน้าต่างขยายออกจากกลาง • ยอดเงินไหลไปค่าใหม่ |
| Rooms | การ์ดห้องไล่ขึ้นทีละใบ |
| กล่องสุ่ม | เหรียญกระจายออกจากกล่องที่เลือก (Jackpot กระจายเยอะกว่า) |

ไฟล์ใหม่ `frontend/src/components/AnimatedNumber.jsx` • CSS ต่อท้าย `poker-table.css`, `lobby.css`, `rooms.css` (หัวข้อ MOTION)

### 2.12 ทดสอบโหลดบน AWS + บัคตัวจับเวลาหลุดการเชื่อมต่อค้าง (12 ต.ค.)

**ทดสอบ:** สร้างระบบเต็มตาม Deployment Guide ด้วย `infra/terraform-test/` แล้วยิงบอท 10 → 1,000 คน — ผลอยู่ใน `docs/loadtest-results.md` และ `docs/loadtest/Test1-Poker777/`, `Test2-Poker777/` (สรุป: **1,000 คนบน Backend t3.micro เครื่องเดียว ใช้ CPU ราวครึ่ง core**, ไม่มีใครหลุด, RDS/Redis/ALB ไม่ใช่คอขวด, read replica ใช้งานจริง)

**บัค `[แก้บัค]` (`backend/src/ws/ws-server.js` → `handleLeaveRoom`):** ตอนผู้เล่นหลุด ระบบใส่รายการใน `poker:disconnect-timers` รอ 30 วิ — ถ้าครบเวลาแล้วห้องถูกลบไปแล้ว / ผู้เล่นออกไปแล้ว / ต่อกลับมาแล้ว โค้ด `return` โดยไม่ลบรายการ → poller (ทุก 0.5 วิ) ทำซ้ำตลอดไป • หลังทดสอบค้าง 95 รายการ → CPU Backend ตอนว่าง 1 % → 6 %, Redis 0.3 % → 4 % • เกิดกับผู้เล่นจริงได้ (กด "ออก" แล้วปิดหน้าเว็บทันที) และสะสมไปเรื่อยๆ • แก้: ลบรายการทันทีเมื่อไม่ต้องใช้แล้ว • **ยังไม่ได้ทดสอบบน AWS** (ต้อง deploy ใหม่)

**บัคตัวที่ 2 `[แก้บัค]` (13 ต.ค., `ws-server.js` → `processDueDisconnectTimers`):** Backend ทุกเครื่องอ่านรายการที่ครบเวลาชุดเดียวกัน เรียงเหมือนกัน ทุก 0.5 วิ แล้วแย่ง lock ห้องเดียวกัน → หลังผู้เล่นหลุดพร้อมกันจำนวนมาก (Frontend ล่ม / deploy ใหม่) เกือบทุกครั้งได้ `Room is busy` + พิมพ์ stack ยาวทุกครั้ง • Load test 4: บอท 2,000 ตัวหลุดพร้อมกัน → 25 นาทีผ่านไปยังค้าง 1,100 รายการ, เครื่องเดียวพิมพ์ error 5,209 ครั้งใน 2 นาที, CPU Backend 16 → 34 % ทั้งที่ไม่มีผู้เล่น (Node RAM 156 → 417 MB) และ Auto Scaling ยิ่งเพิ่มเครื่องยิ่งแย่งกัน • แก้: จองแต่ละรายการด้วย `SET NX PX 2000` ก่อนทำ (เครื่องเดียวทำต่อรายการ ถ้าพังกลางทางการจองหมดอายุเอง), ทำทีละ ≤ 100 รายการต่อรอบ, ไม่พิมพ์ `Room is busy` ของตัวจับเวลานี้เป็น error • ทดสอบในเครื่อง (demo server): บอท 24 ตัวหลุดพร้อมกัน → ถูกเอาออกครบหลัง 30 วิ ห้องถูกลบ ไม่มี error • **ยืนยันบน AWS แล้ว:** รายการค้าง 1,051 รายการหายหมดหลังเปลี่ยนเป็นโค้ดใหม่, CPU ตอนว่าง 6–8 % → 0.5 %

**บัคตัวที่ 3 `[แก้บัค]` (13 ต.ค., `ws-server.js` ตัวจับเวลาทั้ง 3 ตัว + `lockService.js`):** ตัวจับเวลาเริ่มมือ / หมดเวลาตา / หลุดการเชื่อมต่อ ถูกเรียกทุก 0.5 วิด้วย `setInterval` โดยไม่ดูว่ารอบก่อนจบหรือยัง และแต่ละห้องรอ lock ได้ถึง ~2 วิ → รอบซ้อนกันเรื่อยๆ × ทุก Backend ทำรายการเดียวกัน → แย่ง lock กับ Action ของผู้เล่น • Load test 5 (5,000 คน, Backend 4 เครื่อง): `[AutoStart] Room is busy` เครื่องละ ~850 ครั้ง/นาที, บอทโดน `Room is busy` ~2,900 ครั้ง, **latency p50 ~1 วิ / p95 ~8.6 วิ ทั้งที่ CPU แค่ ~13 %** • แก้: รอบเดียวต่อครั้งต่อเครื่อง (`oneAtATime`), จองรายการด้วย `SET NX PX` (`claimTimer`), ตัวจับเวลาลอง lock ครั้งเดียว (`withLock(..., { wait: false })` — Action ของผู้เล่นยังรอได้ ~2 วิเหมือนเดิม), ทีละ ≤ 100 รายการ • ทดสอบในเครื่อง: บอท 64 ตัว เล่น 16 มือ/นาที ไม่มี error, หลุดพร้อมกันแล้วถูกเอาออกครบ • **ยืนยันบน AWS (Load test 6, 5,000 คน):** latency p50 1,317 → 296 ms, p95 8,328 → 410 ms, เกมเดินเร็วขึ้น 4.5 เท่า, "Room is busy" 3,053 → 0

**เครื่องมือใหม่ใน `tools/loadtest/`:** `aws-test.mjs` (ทดสอบไล่ขั้น + ดึงกราฟ/ตัวเลข CloudWatch + วัด DB/RAM ผ่าน SSM), `db-counters.mjs` (นับ SELECT ต่อเครื่อง RDS) • `loadtest.mjs` เพิ่ม `--accounts-only`, `--reuse-only`, `--browse-rps`, p99

---

## 3. Deploy และเครื่องมือ

### `frontend/frontend.sh` (สคริปต์สร้าง AMI Frontend) `[แก้บัค]` (12 ต.ค.)

- **บัค:** nginx ที่สคริปต์ตั้งค่าเสิร์ฟแค่ไฟล์หน้าเว็บ ไม่ได้ส่งต่อ `/auth /users /wallet /tables /health /ws` ไป Internal ALB → ทุก request API ได้ `index.html` กลับมา (Login/เข้าโต๊ะไม่ได้) • ไฟล์เป็น CRLF → `bash` บน Linux พัง (`$'': command not found`)
- **แก้:** ใส่ส่วน proxy ไป Backend (เหมือน `nginx-ec2-site.conf` ที่เคยใช้ได้บนเว็บจริงทุกบรรทัด — เทียบ diff แล้ว) • หา DNS ของ Internal ALB `poker777-prod-internal` เองผ่าน AWS CLI (หรือใส่ `BACKEND_ORIGIN` บรรทัดบนสุดเอง) — ใส่แบบไม่มี `http://` หรือไม่มี `:4000` ก็ได้ • ถ้าหา Backend ไม่เจอจะหยุดพร้อมบอกเหตุผล แทนที่จะสร้าง AMI ที่ใช้ไม่ได้ • `nginx -t` ก่อน restart • แปลงเป็น LF + เพิ่ม `.gitattributes` บังคับ `*.sh` เป็น LF เสมอ
- **เงื่อนไข:** สร้าง Internal ALB ก่อน (ขั้น 13) และ EC2 ที่ใช้สร้าง AMI ต้องมี IAM profile `LabInstanceProfile`
- **[แก้บัค] (13 ต.ค.) — เพดาน ~1,000 ผู้เล่นต่อ Frontend:** nginx ใช้ค่าเริ่มต้น `worker_connections 1024` × 2 worker (t3.micro) และผู้เล่น 1 คนใช้ 2 การเชื่อมต่อ (ฝั่งผู้เล่น + ฝั่ง Internal ALB) → เครื่องละ ~1,000 คนก็เต็ม • Load test 4: ที่ ~2,000 คน (Frontend 2 เครื่อง) nginx เต็ม → health check ล้ม → ASG ปิดเครื่องทิ้งทีละเครื่อง → ผู้เล่นหลุดและต่อใหม่พร้อมกัน → ELB 5xx 43,907 ครั้ง (log: `worker_connections are not enough` 28,816 ครั้ง) ทั้งที่ Backend CPU แค่ ~16 % • แก้: ตั้ง `worker_connections 16384` + `worker_rlimit_nofile 65535` ใน `/etc/nginx/nginx.conf` (รันซ้ำได้) — **AMI Frontend ที่สร้างไปแล้วต้องสร้างใหม่**

| ไฟล์ | เปลี่ยนอะไร | ทำไม |
|---|---|---|
| `frontend/nginx.conf`, `frontend/nginx-ec2-site.conf` | เอา `internal` ออกจาก regex ที่ proxy ไป Backend | `/internal/wallet/adjust` (ปรับเงินใน Wallet ของใครก็ได้) เคยเปิดสู่ Internet — ยืนยันแล้วจากเว็บจริง |
| `backend/ec2-user-data.sh` | ติดตั้ง `jq` • รัน migrate ก่อน start (`node --env-file=… migrate.js`, ลองซ้ำ 6 ครั้ง) • บังคับมี `REDIS_HOST` ใน Secret | เดิม: ไม่มี jq สคริปต์หยุดกลางทาง, ฐานข้อมูลใหม่ไม่มีตาราง, ลืม REDIS_HOST แล้ว Backend ต่อ 127.0.0.1 เงียบๆ |
| `frontend/vite.config.js` | Dev server ส่ง `/auth /users /wallet /tables /health /ws` ต่อไป port 4000 | `api.js` เรียก API ที่ origin เดียวกับหน้าเว็บ (ถูกสำหรับ production) แต่ `npm run dev` ไม่มีตัวส่งต่อ → รันในเครื่องแล้วหน้าเว็บพัง |
| `tools/demo-server/` | รัน Backend จริงด้วย Redis/MySQL จำลองใน RAM + Proxy จำลองเน็ตไม่เสถียร | ทดสอบในเครื่องโดยไม่ต้องมี Docker — วิธีใช้ใน `test_host.md` |
| `tools/loadtest/` | บอทที่สมัคร/นั่ง/เล่นจริงผ่าน WebSocket + วัดเวลาตอบสนอง | ทดสอบโหลด — ดูวิธีใช้บนหัวไฟล์ `loadtest.mjs` |

> ⚠️ ไฟล์ `.sh` ใน working copy บน Windows อาจเป็น CRLF — ถ้าจะ copy ไปวางเป็น EC2 User Data ให้ copy จาก GitHub (เก็บเป็น LF) ไม่งั้น bash error

---

## 4. การทดสอบ

| ชุดทดสอบ | ผล |
|---|---|
| `node --test src/test/game.test.js` | ผ่าน 6/6 |
| `vite build` | ผ่าน |
| Script 2 ผู้เล่น 3 มือ | Wallet ถูกต้อง ไม่นับซ้ำ (ผลรวมเงินคงที่), รหัสห้องผิด → 404, ห้องร้างถูกลบ |
| Browser 2 ผู้เล่น | สร้างห้อง → Buy-in → เล่นจน Showdown, Timeout, Refresh/Leave กลางมือ |
| Reconnect ผ่าน Proxy จำลองเน็ต | หลุด 5 วิ / หลุดตอนตาตัวเอง 20 วิ / หลุด 40 วิ / Half-open 25 วิ — ผ่าน |
| โหลด 10 / 50 บอท (Server เครื่องเดียว, Redis/MySQL จำลอง) | 50/50 นั่งครบ, 967 action ใน 3 นาที, เวลาตอบสนอง p50 2 ms / p95 4 ms, หลุด 0, RAM นิ่งที่ ~204 MB (ไม่มี memory leak), CPU 1–3% (พุ่งเฉพาะตอน Login เพราะ bcrypt) |
| ฟีเจอร์ 5 ต.ค. (บอท + Browser) | Auto start + นับถอยหลัง, ป้าย action/ผู้ชนะ, ช่อง Bet, นั่งกลางมือ, โต๊ะ 9 คนทุกขนาดจอ, สถิติมือที่จบด้วยการหมอบถูกบันทึก |
| เว็บจริง poker777.club (ไม่ล็อกอิน) | HTTPS/Certificate ถูก, Security headers ครบ, `/health` ใช้ได้, WebSocket ไม่มี token ถูกปฏิเสธ — **แต่หน้าเว็บยังเป็นโค้ดเก่า** และ `/internal` เปิดสู่ Internet (แก้ใน repo แล้ว รอ deploy) |

**ยังไม่ได้ทดสอบ:** กับ MySQL / ElastiCache ตัวจริง (โดยเฉพาะ migrate เพิ่มคอลัมน์ `bet_step` บน RDS ที่มีข้อมูลแล้ว), ส่วนที่ต้องล็อกอินบนเว็บจริง, ชุดทดสอบ `auth / wallet / tables` (ต้องใช้ MySQL)

---

## 5. สถานะปัญหาที่เคยรายงาน

| เรื่อง | สถานะ |
|---|---|
| Host = คนที่ต่อ WebSocket คนแรก | ✅ แก้แล้ว (เพื่อนปรับเป็นเช็ค `tables.host_id`) |
| คนสร้างห้องไม่อยู่ → ไม่มีใครเริ่มเกมได้ | ✅ Auto start แก้ให้ในตัว |
| Redis port / TLS hard-code | ✅ เพื่อนแก้แล้ว (`REDIS_PORT`, `REDIS_TLS`) |
| `JWT_SECRET` ใช้ค่า dev ถ้าลืมใส่ใน production | ✅ เพื่อนแก้แล้ว (production บังคับต้องมี) |
| `/internal` เปิดสู่ Internet | ✅ แก้ใน repo แล้ว — **รอ deploy** |
| `ec2-user-data.sh` ไม่มี jq / migrate / เช็ค REDIS_HOST | ✅ แก้แล้ว |
| **เงินไม่ถูกกันไว้ตอนนั่ง (ไม่มี Escrow)** | ❌ ยังไม่แก้ — ดูข้อ 6 |
| ห้องที่ไม่มีใครเข้าค้างในรายการตลอดไป | ✅ แก้แล้ว (7 ต.ค.) — ดู "ลบห้องร้าง" ในข้อ 1 |
| Half-open ช่วงที่ไม่มีมือเล่น — หน้าเว็บไม่รู้ตัวว่าหลุด | ❌ ยังไม่แก้ (Server จัดการถูกแล้ว) |
| ผู้เล่นชิปหมดยังนับเป็นคนไม่หมอบ (มือเล่นยาวจน Showdown) | ❌ ยังไม่แก้ (เงินไม่ผิด) |
| ไม่มีปุ่ม Rebuy | ❌ ยังไม่ทำ |
| Terraform: `backend_internal_dns` ไม่มี `:4000` | ❌ ยังเป็นบัค **ถ้า** deploy ด้วย Terraform (ไฟล์ `nginx-ec2-site.conf` ใส่ `:4000` ถูกแล้ว) |
| RDS Read-replica มีใน Diagram แต่โค้ดไม่ใช้ | ✅ ใช้แล้ว (รายการห้อง/ประวัติ/สถิติ) — ดู "ใช้ RDS Read Replica" ในข้อ 1 |
| CloudFront มีใน Diagram แต่ Learner Lab ใช้ไม่ได้ | ℹ️ ระบบทำงานได้โดยไม่ต้องมี (ALB + ACM ทำ HTTPS แทน) — ควรแก้ Diagram |
| ไฟล์เก่าที่ไม่ได้ใช้ | ❌ ยังอยู่: `ws/ExServer.js`, `ws/Old-server.js`, `services/ExRoomService.js`, `frontend/test.html`, ฟังก์ชันไม่มีใครเรียกใน `roomService.js` |

---

## 6. สิ่งที่ควรทำต่อ

### 🔴 ต้องทำก่อน deploy ครั้งหน้า
1. **Commit + push งานนี้** แล้ว **build/deploy ใหม่จาก `AlmostDone`** ทั้ง Frontend และ Backend — เว็บจริงตอนนี้ยังไม่มีงานแก้ส่วนใหญ่ในไฟล์นี้
2. **รัน migrate บน RDS ก่อนเปิด Backend ใหม่** (`ec2-user-data.sh` ทำให้แล้ว ถ้าใช้วิธีอื่นให้รันเอง) — ไม่งั้นสร้างห้องไม่ได้เพราะยังไม่มีคอลัมน์ `bet_step`

   ```bash
   cd backend && node --env-file=/etc/poker777/backend.env src/scripts/migrate.js
   ```

3. ตรวจ Secret ใน Secrets Manager ให้มีครบ: `DB_HOST DB_USER DB_PASSWORD DB_NAME REDIS_HOST JWT_SECRET INTERNAL_API_KEY CORS_ALLOWED_ORIGINS` (+ `REDIS_TLS=true` ถ้า ElastiCache เปิด Encryption) — `CORS_ALLOWED_ORIGINS=https://poker777.club` (ต้องมี `https://`, ไม่มี `/` ท้าย)
4. หลัง deploy เช็ค

   ```bash
   curl https://poker777.club/health
   ```

   ต้องได้ JSON และ `POST https://poker777.club/internal/wallet/adjust` ต้อง **ไม่** ตอบ `INVALID_INTERNAL_KEY` (แปลว่าไม่ถึง Backend แล้ว)

### 🟠 ควรทำ (กระทบความถูกต้องของเงิน / ความเสถียร)
1. **Escrow เงินตอนนั่ง** — หัก Buy-in จาก Wallet ทันทีที่นั่ง (ธุรกรรม `BUYIN`) และคืนตอนลุก (`SETTLE`) แทนการ Sync ส่วนต่างทุกมือ → กันใช้เงินก้อนเดียวนั่งหลายโต๊ะ และกันยอดเสียหายตอน Wallet ไม่พอ (ตอนนี้ `INSUFFICIENT_BALANCE` แล้วยอดเสียหายไปเงียบๆ)
2. **ชุดทดสอบ `auth / wallet / tables` กับ MySQL จริง** — ใช้ `docker compose up mysql redis` แล้วรัน `npm test` ใน backend อย่างน้อยก่อน deploy
3. **แก้ Terraform** `infra/terraform/compute.tf`: `backend_internal_dns = "${aws_lb.internal.dns_name}:4000"` (ถ้าจะใช้ Terraform deploy)
4. ~~ลบห้องร้าง~~ ทำแล้ว (7 ต.ค.)
5. **ผู้เล่นชิปหมด** — นับเป็น "นั่งพัก" ไม่ใช่คนในมือ (หรือบังคับลุกอัตโนมัติ) + **ปุ่ม Rebuy**
6. **ตั้ง CloudWatch Alarm** สำหรับ 5xx ของ ALB, Unhealthy target, CPU ของ App Server — ตอนนี้ถ้าเว็บล่ม (เช่น 503 ตอน Learner Lab หมดเวลา) ไม่มีใครรู้

### 🟢 ถ้ามีเวลา (UX / ความสะอาดของโค้ด)
1. ป้าย "นั่งพัก / Sit out" — ให้ผู้เล่นพักไม่รับไพ่ชั่วคราวได้ (ตอนนี้ถ้าไม่กดจะโดน Auto-fold ทุกมือ)
2. แจ้งผู้เล่นเมื่อเปิดโต๊ะเดียวกันซ้ำหลายแท็บ (แท็บเก่าถูกตัดเงียบๆ)
3. ข้อความ ping ระดับ App ให้หน้าเว็บรู้ตัวว่าหลุดแม้ไม่มีมือกำลังเล่น
4. ลบไฟล์เก่าที่ไม่ได้ใช้ (รายการในข้อ 5) และโฟลเดอร์ `deploy/` (ซ้ำกับ `backend/ec2-user-data.sh`)
5. ~~ใช้ RDS Read-replica~~ ทำแล้ว — ถ้า deploy ด้วย `backend/ec2-user-data.sh` อย่าลืมเพิ่ม `DB_READ_HOSTS` ใน Secret (Security Group ของ Replica ต้องให้ App Server ต่อ port 3306 ได้เหมือน Primary)
6. แก้ Diagram: เอา CloudFront ออก/หมายเหตุว่า Learner Lab ใช้ไม่ได้
7. ลบบัญชีบอทจากการทดสอบโหลดบนฐานข้อมูลจริง (ถ้าเคยรัน `loadtest` กับเว็บจริง)

   ```sql
   DELETE FROM users WHERE username LIKE 'bot\_%';
   ```
