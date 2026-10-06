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

---

## 3. Deploy และเครื่องมือ

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
| ห้องที่ไม่มีใครเข้าค้างในรายการตลอดไป | ❌ ยังไม่แก้ |
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
4. **ลบห้องร้าง** — งานเก็บกวาดใน `ws-server.js` (มี poller อยู่แล้วทุก 0.5 วิ) ลบห้องที่สร้างเกิน N นาทีแต่ไม่มีใครนั่ง ทั้งใน DB และ Redis
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
