# 🃏 Poker777 — คู่มือ Deploy & Setup

> **Core API & Frontend Integration** (Phase 1-2)
> Team: REST API + Frontend (Auth, Users, Lobby, Wallet)

---

## 📋 สิ่งที่ต้องมีก่อนเริ่ม

| รายการ | เวอร์ชัน | ทำไมต้อง |
|---|---|---|
| **Docker Desktop** | 24+ | รัน MySQL 8 + Redis 7 |
| **Node.js** | 20+ (แนะนำ 24) | รัน backend + test |
| **Git** | ล่าสุด | clone repo |

ตรวจสอบ:
```bash
docker --version
node --version
npm --version
git --version
```

---

## 🚀 เริ่มใช้งาน (5 นาที)

### 1. Clone & เข้า directory

```bash
git clone <repo-url> Poker777
cd Poker777
```

### 2. เปิดฐานข้อมูล (MySQL + Redis)

```bash
docker compose up -d
```

รอสักครู่จน health check ผ่าน:
```bash
docker compose ps
# ต้องเห็น STATUS "healthy" ทั้ง mysql และ redis
```

> **⚠️ พอร์ตชน?** ถ้าเครื่องมี MySQL รันอยู่ที่พอร์ต 3306 อยู่แล้ว ให้แก้ `docker-compose.yml` บรรทัด `ports: - "3307:3306"` เป็นพอร์ตอื่นที่ว่าง

### 3. ติดตั้ง dependencies

```bash
cd backend
npm install
```

### 4. ตั้งค่า environment

```bash
cp .env.example .env
```

แก้ไข `.env` เฉพาะที่ต้องเปลี่ยน (ถ้ามี):
- **DB_HOST / DB_PORT** — ถ้าแก้พอร์ต MySQL ใน docker-compose
- **JWT_SECRET** — เปลี่ยนเป็นค่า random 32+ ตัวสำหรับ production
- **CORS_ALLOWED_ORIGINS** — เพิ่ม URL frontend ถ้าไม่ได้เปิดผ่าน `localhost:5500`

### 5. สร้างฐานข้อมูล ( migrate )

```bash
npm run migrate
```

Output ที่คาดหวัง:
```
[info] Connected to MySQL 127.0.0.1:3307/poker777
[info] Creating tables...
[done] Schema ready — tables: users, wallets, transactions, tables
```

> 💡 **เริ่มต้นใหม่ทั้งหมด?** ใช้ `npm run migrate:fresh` (ลบตารางเก่าแล้วสร้างใหม่)

### 6. รัน API Server

```bash
npm run dev
```

Server จะเริ่มที่ **http://localhost:4000**

```
[config] env=development port=4000 db=127.0.0.1:3307/poker777
[server] Poker777 Core API listening on http://localhost:4000
```

### 7. ทดสอบด้วย curl

```bash
# Health check
curl http://localhost:4000/health

# Register
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@mail.com","password":"p@ssw0rd"}'

# Login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"testuser","password":"p@ssw0rd"}'
# จะได้ token → เก็บไว้

# ดู profile (แทน YOUR_TOKEN)
curl http://localhost:4000/users/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 8. เปิด Frontend

เปิด `frontend/index.html` ใน browser:

**วิธีที่ 1 — Live Server (แนะนำ):**
```bash
# ใน VS Code: ขวาที่ index.html → Open with Live Server
# หรือติดตั้ง extension "Live Server" แล้วคลิกขวา
```

**วิธีที่ 2 — npx serve:**
```bash
cd frontend
npx serve -l 5500
# เปิด http://localhost:5500
```

**วิธีที่ 3 — เปิดไฟล์ตรง (file://):**
Double-click `frontend/index.html` ได้เลย (CORS อนุญาต `Origin: null` ใน dev mode)

---

## 📂 โครงสร้างโปรเจค

```
Poker777/
├── backend/
│   ├── .env.example          # Template environment variables
│   ├── package.json          # Dependencies + scripts
│   └── src/
│       ├── config/           # env.js, db.js, redis.js
│       ├── middleware/       # auth.js, cors, rateLimit, errorHandler
│       ├── routes/           # auth.js, users.js, health.js
│       ├── services/         # auth.js (business logic)
│       ├── validators/       # auth.js (zod schemas)
│       ├── db/
│       │   └── schema.sql    # DDL tables
│       ├── scripts/
│       │   └── migrate.js    # Migration runner
│       ├── test/
│       │   └── auth.test.js  # Unit tests (12 เคส)
│       └── server.js         # Express app entry
├── frontend/
│   ├── index.html            # Login / Register
│   ├── lobby.html            # Lobby (ดูโต๊ะ, สร้างห้อง)
│   ├── css/
│   │   ├── index.css         # หน้า login/register styles
│   │   └── lobby.css         # Lobby styles
│   └── js/
│       ├── api.js            # API wrapper กลาง (fetch + JWT)
│       └── avatar-picker.js  # Avatar selection widget
├── docker-compose.yml        # MySQL 8 + Redis 7
└── docs/
    └── ROADMAP.md            # 8 phases roadmap
```

---

## 🧪 ทดสอบ (Testing)

### Unit Tests (12 เคส)

```bash
cd backend
npm test
```

ผลที่คาดหวัง:
```
✅ PASS: POST /auth/register — returns 201 + welcome bonus
✅ PASS: POST /auth/login — returns 200 + JWT
✅ PASS: GET /users/me — returns profile with balance
...
12 subtests passed
```

### End-to-End Flow (curl)

```bash
# 1. Register → ได้ token
TOKEN=$(curl -s -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"e2euser","email":"e2e@mail.com","password":"pass123"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# 2. GET /users/me
curl -s http://localhost:4000/users/me -H "Authorization: Bearer $TOKEN"

# 3. PATCH avatar
curl -s -X PATCH http://localhost:4000/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"avatar_id":"3"}'

# 4. Verify persisted
curl -s http://localhost:4000/users/me -H "Authorization: Bearer $TOKEN"
```

---

## 🔧 Environment Variables

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `PORT` | `4000` | HTTP port สำหรับ API |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `DB_HOST` | `127.0.0.1` | MySQL host |
| `DB_PORT` | `3307` | MySQL port (docker map) |
| `DB_USER` | `poker` | MySQL username |
| `DB_PASSWORD` | `pokerpass` | MySQL password |
| `DB_NAME` | `poker777` | Database name |
| `REDIS_HOST` | `127.0.0.1` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | `dev-only-...` | 🔒 **เปลี่ยนใน production** |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime |
| `JWT_ISSUER` | `poker777` | Token issuer |
| `WELCOME_BONUS` | `1000` | ชิปเริ่มต้นเมื่อ register |
| `CORS_ALLOWED_ORIGINS` | `localhost:5173,...` | Comma-separated frontend URLs |
| `INTERNAL_API_KEY` | `dev-internal-...` | 🔒 **Shared กับทีม WS** |

---

## 🛠️ คำสั่งที่ใช้บ่อย

```bash
# Start database
docker compose up -d

# Stop database
docker compose down

# Reset database (ลบข้อมูลเก่า)
cd backend && npm run migrate:fresh

# Start dev server (auto-reload)
cd backend && npm run dev

# Run tests
cd backend && npm test

# Frontend (VS Code Live Server หรือ)
cd frontend && npx serve -l 5500
```

---

## 🐛 Troubleshooting

### ❌ `EADDRINUSE` พอร์ต 4000

```bash
# Windows — หา process ที่ใช้พอร์ต
netstat -ano | findstr :4000
taskkill /PID <pid> /F

# Linux/Mac
lsof -i :4000
kill -9 <pid>
```

### ❌ `EADDRINUSE` พอร์ต 3306 (MySQL)

เครื่องมี MySQL ตัวอื่นรันอยู่ → แก้ `docker-compose.yml`:
```yaml
ports:
  - "3307:3306"  # เปลี่ยน 3306 เป็น 3307
```
แล้วแก้ `.env` ให้ `DB_PORT=3307`

### ❌ CORS `Origin null not allowed`

เกิดจากเปิด `index.html` ผ่าน `file://` → โค้ดรองรับแล้วใน dev mode แต่ถ้ายังเจอ:
- ใช้ Live Server แทน (แนะนำ)
- หรือเช็ค `.env` ว่า `NODE_ENV=development`

### ❌ Migration ล้มเหลว

```bash
# เช็ค MySQL connection
docker compose exec mysql mysql -u poker -ppokerpass poker777 -e "SHOW TABLES;"

# Fresh start
docker compose down -v    # ลบ volume (ข้อมูลหาย)
docker compose up -d
cd backend && npm run migrate
```

### ❌ `bcrypt` build error

```bash
npm install bcryptjs   # ใช้เวอร์ชัน pure-JS ไม่ need native build
```

---

## 📡 API Endpoints (Phase 1)

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | ❌ | สมัคร + ได้ welcome bonus 1,000 |
| POST | `/auth/login` | ❌ | Login + รับ JWT token |

### Users
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | ✅ | ดู profile, balance, avatar |
| PATCH | `/users/me` | ✅ | อัปเดต display_name, avatar_id |

### Wallet (Phase 2)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/wallet/topup` | ✅ | เติมชิป |
| GET | `/wallet/transactions` | ✅ | ดูประวัติ |

### Tables (Phase 3)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/tables` | ✅ | ดูรายการโต๊ะ |
| POST | `/tables` | ✅ | สร้างห้องใหม่ |

---

## 🤝 สัญญาระหว่างทีม (Team Contract)

| หัวข้อ | รายละเอียด |
|---|---|
| **JWT Secret** | `JWT_SECRET` ใน `.env` — ทั้ง 2 ทีมต้องค่าเดียวกัน |
| **Internal API** | `POST /internal/wallet/adjust` — ทีม WS เรียกเพื่อหัก/เติมชิปตอนจบเกม |
| **Idempotent** | ใช้ `X-Idempotency-Key` + `ref_id` ป้องกัน double charge |
| **Redis Keys** | `poker:table:{id}:seats` — ทีม WS เขียน, ทีม API อ่าน |
| **Base URL** | `http://localhost:4000` (dev) |

---

## 📝 Notes

- **Port 3307 vs 3306:** Docker map 3307 → 3306 เพื่อเลี่ยงชนกับ MySQL ในเครื่อง
- **Redis ใน test:** ปิดอัตโนมัติด้วย `REDIS_DISABLED=1` (lazy init ใน `redis.js`)
- **CORS:** อนุญาต `Origin: null` ใน dev mode เท่านั้น (file://)
- **Avatar:** เก็บเป็น `avatar_id` ในตาราง `users` (NULL = default)
- **Welcome Bonus:** 1,000 chips — สร้างพร้อม transaction record

---

*เขียนเมื่อ Sep 2026 — อัปเดตตามแต่ละ phase*
