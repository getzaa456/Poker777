# Poker777 — เปิดเล่นทดสอบในเครื่องตัวเอง (2 ผู้เล่น)

มี 2 วิธี เลือกอย่างใดอย่างหนึ่ง

| | วิธี A: Docker | วิธี B: Demo (ไม่ต้องมี Docker) |
|---|---|---|
| ใช้อะไร | MySQL + Redis ตัวจริง (เหมือน Production) | Redis / MySQL จำลองใน RAM |
| ต้องมี | Docker Desktop | Node.js 20.6 ขึ้นไป |
| ข้อมูล | อยู่ถาวรใน Docker volume | **หายทุกครั้งที่ปิด Server** |
| บัญชีทดสอบ | สมัครเอง | สร้างให้อัตโนมัติ `player1`, `player2` |
| ทดสอบเน็ตไม่เสถียร | — | ได้ (มี Proxy จำลอง) |

> **ทำไมต้องเปิด 2 ที่อยู่ต่างกัน:** การ Login เก็บใน `localStorage` ของแต่ละ Origin ถ้าเปิด `localhost:3000` สองแท็บ ผู้เล่นทั้งสองจะกลายเป็นคนเดียวกัน
> ให้ใช้ **`http://localhost:3000`** กับ **`http://127.0.0.1:3000`** หรือใช้หน้าต่างปกติ + หน้าต่าง Incognito

---

## วิธี A: Docker (MySQL + Redis ตัวจริง)

1. สร้างไฟล์ `.env` ที่ root โปรเจกต์ จากตัวอย่าง

   ```bash
   cp .env.example .env
   ```

   (PowerShell: `Copy-Item .env.example .env`) — ค่าเริ่มต้นใช้ได้เลย

2. Build และเปิดทุกอย่าง (MySQL, Redis, Backend, Frontend) — Backend จะรัน migration ให้เอง

   ```bash
   docker compose up -d --build
   ```

3. เช็คว่าพร้อม: เปิด `http://localhost:4000/health` ต้องได้ `{"status":"ok",...}`
4. ไปที่ **[เริ่มเล่น 2 ผู้เล่น](#เริ่มเล่น-2-ผู้เล่น)** แล้ว **สมัครบัญชีใหม่ 2 บัญชี** (ได้คนละ 1,000 ชิป)

คำสั่งที่ใช้บ่อย:

```bash
docker compose logs -f backend
```

```bash
docker compose down
```

ล้างข้อมูลทั้งหมด (บัญชี/ห้อง/เงิน) แล้วเริ่มใหม่:

```bash
docker compose down -v
```

---

## วิธี B: Demo (ไม่ต้องมี Docker)

รัน `backend/src/server.js` ตัวจริงโดยไม่แก้โค้ด แค่สลับ Redis / MySQL เป็นตัวจำลองใน RAM (ดู `tools/demo-server/`)

1. ติดตั้ง dependencies (ครั้งแรกครั้งเดียว)

   ```bash
   cd backend && npm install && cd ..
   cd frontend && npm install && cd ..
   cd tools/demo-server && npm install && cd ../..
   ```

2. **Terminal 1** — Backend (port 4000) + สร้างบัญชี `player1`, `player2` ให้อัตโนมัติ

   ```bash
   cd tools/demo-server
   npm start
   ```

   ต้องเห็น `[demo] seeded player1: ok` และ `[demo] seeded player2: ok`

3. **Terminal 2** — Frontend (port 3000)

   ```bash
   cd frontend
   npm run dev
   ```

4. บัญชีทดสอบ (สร้างใหม่ทุกครั้งที่ `npm start`, ได้คนละ 1,000 ชิป)

   | Username | Password |
   |---|---|
   | player1 | `demo-pass-123` |
   | player2 | `demo-pass-123` |

> ถ้ามีไฟล์ `.env` ที่ root และตั้ง `VITE_API_BASE` ไว้ ต้องเป็น `http://localhost:4000` หรือเว้นว่าง
> ถ้า port 3000 / 4000 ถูกใช้อยู่ ให้ปิดโปรแกรมนั้นก่อน (Windows: `netstat -ano | findstr :4000` แล้ว `taskkill /PID <pid> /F`)

---

## เริ่มเล่น 2 ผู้เล่น

| | ผู้เล่น 1 | ผู้เล่น 2 |
|---|---|---|
| เปิด | `http://localhost:3000` | `http://127.0.0.1:3000` (หรือ Incognito) |
| Login | player1 | player2 |

1. **ผู้เล่น 1:** กด **CREATE ROOM** → ตั้งชื่อ / เลือก Buy-in / จำนวนที่นั่ง → **Create Room** → จดรหัสห้อง 6 ตัว → **Enter Table**
2. **ผู้เล่น 1:** เลื่อนเลือก Buy-in → **SIT DOWN**
3. **ผู้เล่น 2:** ใส่รหัสห้องในช่อง **Enter Room Code** → **Join** (หรือกด **JOIN ROOM** แล้วเลือกจากรายการ) → เลือก Buy-in → **SIT DOWN**
4. **Host** (คนที่ SIT DOWN ก่อน) กด **START GAME**
5. เล่นได้เลย — แต่ละตามีเวลา 15 วินาที ถ้าหมดเวลาระบบจะ Check ให้ (ถ้า Check ได้) หรือ Fold
6. จบมือแล้ว Host กด **START GAME** เพื่อเริ่มมือต่อไป

Blinds คือ 10 / 20 (ตั้งใน `.env`: `POKER_SMALL_BLIND`, `POKER_BIG_BLIND`) ส่วนค่า min / max ตอนสร้างห้องคือช่วง **Buy-in**

---

## Checklist สิ่งที่ควรลอง

- [ ] FOLD / CHECK / CALL / BET / RAISE / ALL IN — ปุ่มที่ใช้ไม่ได้ในจังหวะนั้นจะกดไม่ได้, ปุ่ม CALL บอกยอดที่ต้องจ่าย
- [ ] เล่นจนถึง Showdown — เห็นไพ่คู่แข่ง, ผู้ชนะมีกรอบสีเขียว
- [ ] ปล่อยให้หมดเวลา — วงนับเวลาสีชมพูลดลง, 5 วินาทีสุดท้ายเป็นสีแดงและมีเสียงติ๊ก
- [ ] เสียง — กดที่ไหนก็ได้บนหน้าก่อนหนึ่งครั้ง (Browser บังคับ), ปุ่ม 🔊/🔇 บนหัวโต๊ะ
- [ ] Refresh หน้ากลางมือ — กลับมานั่งที่เดิม ไพ่เดิม ไม่ถามเงินใหม่
- [ ] ปิดแท็บผู้เล่น 2 แล้วรอเกิน 30 วินาที — ผู้เล่น 2 ถูกลุกจากโต๊ะ ชิปคืน Wallet
- [ ] กด **Leave** กลางมือ — กลับ Lobby, ถือว่า Fold
- [ ] กลับ Lobby แล้วดูยอดชิปมุมซ้ายบน / ประวัติธุรกรรม (กดที่รูปโปรไฟล์) — ยอดต้องเท่ากับ ชิปเริ่ม ± ที่ได้/เสียจริง ไม่นับซ้ำ
- [ ] ทุกคนออกจากห้อง — ห้องหายจากรายการ **JOIN ROOM**

---

## (ทางเลือก) ทดสอบเน็ตไม่เสถียร — ใช้กับวิธี B เท่านั้น

ให้ผู้เล่น 2 ต่อผ่าน Proxy ที่เราสั่งตัด/ค้างได้ ส่วนผู้เล่น 1 ต่อตรง

1. **Terminal 3** — Proxy (port 4200 → 4000, คุมที่ port 4299)

   ```bash
   cd tools/demo-server
   npm run flaky
   ```

2. **Terminal 4** — Frontend ตัวที่สอง (port 3200) ที่ยิงผ่าน Proxy

   Git Bash / macOS / Linux:

   ```bash
   cd frontend
   VITE_API_BASE=http://127.0.0.1:4200 npx vite --port 3200
   ```

   PowerShell:

   ```powershell
   cd frontend; $env:VITE_API_BASE="http://127.0.0.1:4200"; npx vite --port 3200
   ```

3. ผู้เล่น 2 เปิด **`http://127.0.0.1:3200`** แทน (Login ใหม่ด้วย player2)
4. ระหว่างเล่น สั่ง Proxy (เปิด URL ใน Browser หรือใช้ `curl`)

   | คำสั่ง | จำลอง | สิ่งที่ควรเห็น |
   |---|---|---|
   | `http://localhost:4299/drop` | สัญญาณหาย | ผู้เล่น 2 มีแถบเหลือง "Connection lost", ผู้เล่น 1 เห็นผู้เล่น 2 เป็น `DISCONNECTED` |
   | `http://localhost:4299/freeze` | เน็ตค้าง (ต่ออยู่แต่ข้อมูลไม่ไหล) | ภายใน ~6 วิหลังหมดเวลา Turn ผู้เล่น 2 ขึ้นแถบเหลือง, ภายใน 15–30 วิ Server ขึ้น `DISCONNECTED` |
   | `http://localhost:4299/up` | เน็ตกลับมา | ภายใน 30 วิ: กลับมาที่เดิม + "Reconnected" / เกิน 30 วิ: แจ้งว่าหลุดนานเกินไป ให้เลือก Buy-in ใหม่ |
   | `http://localhost:4299/status` | ดูสถานะ | |

---

## แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| หน้าเว็บขึ้น "Cannot reach server" | Backend ยังไม่ขึ้น หรือ `VITE_API_BASE` ไม่ใช่ `http://localhost:4000` |
| Login แท็บหนึ่งแล้วอีกแท็บเปลี่ยนคนตาม | เปิด Origin เดียวกัน — ใช้ `localhost` กับ `127.0.0.1` หรือ Incognito |
| ไม่มีปุ่ม START GAME | ไม่ใช่ Host (Host = คนที่ SIT DOWN ก่อน) หรือยังมีผู้เล่นที่มีชิปไม่ถึง 2 คน |
| "Table is already in progress" | เข้าห้องระหว่างมือกำลังเล่นไม่ได้ รอให้จบมือก่อน |
| วิธี B: Login ไม่ได้หลังเปิด Server ใหม่ | ข้อมูลอยู่ใน RAM — บัญชีเดิมหาย ระบบสร้าง player1/player2 ใหม่ให้แล้ว ให้ Log out แล้ว Login ใหม่ |
| ไม่มีเสียง | กดที่หน้าเว็บก่อนหนึ่งครั้ง และเช็คว่าไม่ได้กด 🔇 |
