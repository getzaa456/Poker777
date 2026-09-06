# 🗺️ Roadmap ทีม Core API & Frontend Integration — Poker777

ประกอบ Architecture Diagram (AWS: CloudFront+S3 → frontend, ALB → Web/App Server → RDS MySQL + ElastiCache Redis, 2 AZ)

ขอบเขตทีมเรา (HTTP REST): `/auth/register`, `/auth/login`, `/users/me`, `/tables` (GET/POST), `/wallet/topup`, `/wallet/transactions` + Frontend Integration
ขอบเขตอีกทีม (WebSocket): game engine, hand evaluator, turn timer, broadcast, Redis state

---

## Stack ที่แนะนำ (สลับได้ตอน Phase 0)

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| Backend | Node.js 20 + Express | ภาษาเดียวกับฝั่ง WS (น่าจะใช้ Node) — share JWT secret / contract ง่าย |
| DB | MySQL 8 (mysql2 หรือ Prisma) | ตรงกับ RDS MySQL ใน diagram |
| Cache | Redis (ioredis) | อ่าน seat count ที่ฝั่ง WS เขียน |
| Auth | JWT HS256 (jsonwebtoken) + bcrypt | ฝั่ง WS verify token เดียวกันได้ด้วย secret เดียวกัน |
| Local dev | docker-compose (MySQL + Redis) | เลียนแบบ ElastiCache/RDS บนเครื่อง |

หลักการเศรษฐกิจชิป: **ชิปเป็น INT เท่านั้น**, ทุกการเปลี่ยนแปลงต้องเกิดเป็นแถวใน `transactions` (audit log), การหักเงินใช้ atomic `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?` กัน race condition

---

## 🤝 สัญญาระหว่างทีม (Cross-team Contracts) — ต้องเคาะก่อน/ระหว่าง Phase 0

1. **JWT Contract** — algorithm HS256, secret ร่วม (dev: .env ร่วม / prod: Secrets Manager), claims `{ sub: userId, username, iat, exp }`, อายุ token, วิธีส่งให้ WS (`?token=` ตอน handshake)
2. **Chip Settlement** — จบแต่ละ hand ฝั่ง WS เรียก `POST /internal/wallet/adjust` (ทีมเราเป็นเจ้าของการเขียน wallet แต่ผู้เดียว) พร้อม header `X-Internal-Key` + idempotency key `hand_id` กันหัก/จ่ายซ้ำ
3. **Redis Key Schema** — `poker:table:{id}:state` = WS owns, `poker:table:{id}:seats` = WS เขียน / API เราอ่าน (read-only) เพื่อเอายอดคนนั่งมา merge ใน `GET /tables`
4. **Error Format** — `{ "error": { "code": "WALLET_INSUFFICIENT", "message": "..." } }` ใช้ร่วมกันทั้ง REST และ WS

---

## Phase 0 — Foundation & Contracts (≈ 3–4 วัน)

- [ ] โครงสร้าง repo: `backend/src/{routes,controllers,services,middleware,config}` + `docs/`
- [ ] docker-compose: MySQL 8 + Redis 7
- [ ] DB Schema (DDL):
  - `users(id PK, username UQ, email UQ, password_hash, avatar_id, created_at)`
  - `wallets(user_id PK/FK, balance INT UNSIGNED, updated_at)`
  - `transactions(id PK, user_id FK, type ENUM('TOPUP','BONUS','SETTLE'), amount INT, balance_after INT, ref_id UQ, created_at, INDEX(user_id,created_at))`
  - `tables(id PK, room_code CHAR(6) UQ, name, host_id FK, min_bet INT, max_bet INT, max_seats TINYINT, status ENUM('OPEN','CLOSED'), created_at)`
- [ ] OpenAPI spec ร่างของ endpoint ทั้งหมด
- [ ] ประชุมอีกทีม → เซ็นสัญญา 4 ข้อด้านบน → `docs/CONTRACTS.md`
- [ ] Backend skeleton + `GET /health`

**DoD:** `docker-compose up` แล้วยิง `/health` ผ่าน, CONTRACTS.md ทั้งสองทีมเห็นชอบ

## Phase 1 — Authentication & User System (≈ 4–5 วัน)

- [ ] `POST /auth/register` — validate (email format, username 3–20, password ≥ 8), bcrypt cost 12, username/email ซ้ำ → 409, สมัครสำเร็จได้ welcome chips (เช่น 1,000) เป็น transaction `BONUS` ใน DB transaction เดียวกัน
- [ ] `POST /auth/login` — ตรวจ credential → sign JWT → `{ token, user }` (ข้อความผิดต้องไม่แยกว่า "user ไม่_exist" หรือ "รหัสผิด" — 401 เดียวกัน)
- [ ] middleware `auth` (verify JWT → `req.user`)
- [ ] `GET /users/me` — profile + balance + avatar
- [ ] ➕ `PATCH /users/me` (เพิ่มจากสเปก — UI มี avatar picker ต้องมีที่บันทึก)
- [ ] rate limit `/auth/*` (เช่น 5 req/min/IP)
- [ ] tests + Postman collection

**DoD:** flow register → login → me ผ่าน | register ซ้ำได้ 409 | token พังได้ 401

## Phase 2 — Wallet & Chip Economy (≈ 3–4 วัน)

- [ ] `POST /wallet/topup` — amount ต้องเป็น int > 0 มีเพดานต่อครั้ง, atomic update + insert transaction ใน DB transaction เดียว
- [ ] `GET /wallet/transactions` — pagination `?page&limit`, ใหม่สุดก่อน, มี `balance_after`
- [ ] `POST /internal/wallet/adjust` — สำหรับ WS team, ตรวจ `X-Internal-Key`, idempotency ด้วย `ref_id = hand_id` (ซ้ำ → 200 เดิม ไม่ปรับยอดซ้ำ)
- [ ] concurrency test: ยิง topup/adjust ขนาน 50 คำขอ ยอดรวมต้องถูกต้องเป๊ะ (no lost update)

**DoD:** ทุกการเปลี่ยนแปลงมีแถว transactions | concurrency test ผ่าน

## Phase 3 — Lobby & Table Management (≈ 3–4 วัน)

- [ ] `POST /tables` — สร้างห้อง (name, min_bet, max_bet, max_seats) → gen `room_code` 6 ตัว, status OPEN
- [ ] `GET /tables` — list ห้อง OPEN + merge จำนวนคนนั่งจาก Redis (key ตามสัญญา)
- [ ] ➕ `GET /tables/by-code/:code` — รองรับช่อง "Enter Room Code" ใน lobby UI
- [ ] ตกลงกับ WS: ใคร flip status → CLOSED (host ออก / ครบ hand สุดท้าย)

**DoD:** สร้างห้อง → โผล่ใน list พร้อม seat count ที่อัพเดทเมื่อมี WS simulator เข้ามา

## Phase 4 — Frontend Integration (≈ 5–6 วัน)

สถานะปัจจุบัน: หน้าจอเสร็จแต่ **ยังไม่มี API call เลย** (ค่าใน poker-table.html เป็น hardcoded: chips 2,680 / pot 850)

- [ ] `frontend/js/api.js` — fetch wrapper: baseURL, แนบ `Authorization: Bearer` อัตโนมัติ, 401 → เด้งกลับหน้า login, normalize error
- [ ] `index.html` — ผูก `login-form` / `register-form` เข้า API (ตอนนี้ form ยังไม่มี JS), เก็บ token → ไป lobby
- [ ] `lobby.html` — โหลด `/users/me` เข้า profileWidget | `confirmAvatarBtn` → `PATCH /users/me` | แทนที่ปุ่มห้อง hardcoded ด้วย list จาก `GET /tables` | modal สร้างห้อง → `POST /tables` | room code → `GET /tables/by-code/:code` แล้วส่ง `tableId` ไป poker-table.html
- [ ] `poker-table.html` — `user-chips` จาก `/users/me` (เลิก hardcoded) | ส่วน pot/ไพ่ ในโต๊ะ = งานฝั่ง WS
- [ ] auth guard ทุกหน้า + loading state + error toast + disable ปุ่มกันกดเบิ้ล

**DoD:** journey สมัคร → login → lobby → สร้าง/เข้าห้อง ผ่านได้โดยไม่มีข้อมูล hardcoded

## Phase 5 — Security Hardening & Quality (≈ 2–3 วัน)

- [ ] helmet, CORS whitelist (origin ของ CloudFront + localhost dev เท่านั้น), body size limit
- [ ] ทบทวน: parameterized queries 100% (SQL injection), ไม่มี secret ใน code (.env + .gitignore)
- [ ] rate limit เพิ่มจุดเสี่ยง, structured log + request-id (ส่ง CloudWatch ต่อ)
- [ ] load test (artillery/k6) บน REST endpoints — ตั้งเป้าเช่น `GET /tables` รับได้ ≥ 200 req/s
- [ ] เช็ก OWASP Top 10 checklist

**DoD:** security checklist + load test report ผ่าน

## Phase 6 — AWS Deployment ตาม Diagram (≈ 3–4 วัน)

- [ ] Frontend → S3 + CloudFront (+ ACM HTTPS)
- [ ] Backend → App Server (EC2, private subnet, 2 AZ) หลัง ALB; Web Server (public subnet) เป็น nginx proxy/SSL termination ตาม diagram
- [ ] RDS MySQL: Multi-AZ + read replica (endpoint อ่านเช่น `GET /tables`, `GET /wallet/transactions` ชี้ replica ได้)
- [ ] ElastiCache Redis — cluster เดียวกับทีม WS แต่แยก key prefix ตามสัญญา
- [ ] Secrets Manager/SSM: JWT secret, DB creds, internal key
- [ ] CloudWatch: log group + alarm (5xx rate, p95 latency)
- [ ] CI/CD: GitHub Actions → test → deploy (S3 sync สำหรับ frontend, CodeDeploy/SSH สำหรับ backend)

**DoD:** ยิง register → login → topup บน domain จริงผ่าน HTTPS จากนอก VPC ผ่าน

## Phase 7 — Cross-team Integration & E2E (≈ 3–4 วัน)

- [ ] WS team handshake ด้วย JWT ตาม contract
- [ ] ทดสอบ settlement: จบ hand → `POST /internal/wallet/adjust` → ยอดใน wallet + transactions ถูก
- [ ] E2E เต็ม: user 2 คน → สร้างโต๊ะ → เข้าทาง WS → เล่น 1 hand → ยอดชิปเปลี่ยนถูกต้องทั้ง 2 ฝ่าย
- [ ] edge cases: disconnect กลาง hand, settle ซ้ำ, token หมดอายุกลางเกม, โต๊ะเต็ม
- [ ] ซ้อม demo + ปิดเอกสาร

**DoD:** E2E script ผ่านครบทุกเคส พร้อมเดโม่

---

## ไทม์ไลน์แนะนำ

รวม ≈ **4–5 สัปดาห์** (P0→P7 ตามลำดับ แต่เหลื่อมได้: Phase 4 ส่วนหน้า login เริ่มได้ทันทีที่ Phase 1 จบ ไม่ต้องรอ P2–P3)

## Endpoint เพิ่ม beyond สเปกเดิม (เสนอทีม/อาจารย์)

| Endpoint | เหตุผล |
|---|---|
| `PATCH /users/me` | UI มี avatar picker ต้องมีที่บันทึก |
| `GET /tables/by-code/:code` | UI มีช่อง Enter Room Code |
| `POST /internal/wallet/adjust` | ทางเดียวที่ฝั่ง WS ปรับยอดชิป — ทีมเราคุม economy integrity |
