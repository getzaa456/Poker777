# Poker777 — ติดตั้งระบบเต็มบน AWS Learner Lab ด้วย Terraform และทดสอบโหลด

สร้างระบบตาม "Poker777 Deployment Guide" ของทีมด้วยคำสั่งเดียว แล้วยิงบอทเล่นจริงเพื่อวัดความจุ / Auto Scaling — ผลที่ทีมได้ไปแล้วอยู่ใน [`docs/loadtest-results.md`](../../docs/loadtest-results.md) และ `docs/loadtest/Test1–6-Poker777/`

> **ใช้ในบัญชี Learner Lab ของตัวเองเท่านั้น** • ระบบคิดเงินราว **$0.37/ชม. (~$9/วัน)** ตลอดที่เปิดไว้ — ทดสอบเสร็จต้อง `terraform destroy` ทุกครั้ง

## ได้อะไรบ้าง

```
ผู้เล่น → Public ALB → Frontend (nginx, ASG 2–4) → Internal ALB :4000 → Backend (Node.js, ASG 2–4 + กฎ CPU)
                                                                              ├→ RDS MySQL writer + read replica 3 (+ RDS Proxy)
                                                                              └→ ElastiCache Redis primary + replica
```

| ส่วน | รายละเอียด |
|---|---|
| เครือข่าย | VPC 10.40.0.0/16, 2 AZ, subnet public / frontend / app / data, NAT 2 ตัว, Security Group ตาม guide |
| Frontend | t3.micro × 2 (ASG min 2 / max 4) — รัน `frontend/frontend.sh` ตอนเปิดเครื่อง (build เว็บ + nginx) |
| Backend | t3.micro × 2 (ASG min 2 / max 4) + **Auto Scaling ตาม CPU เฉลี่ย** (ค่าเริ่ม 30 %) — รัน `backend/ec2-user-data.sh` |
| ฐานข้อมูล | RDS db.t4g.micro writer + replica 3, gp3 50 GB (ขยายเองถึง 100) • Redis cache.t3.micro × 2 (TLS) |
| อื่นๆ | Secrets Manager (`poker777/prod/backend`, `poker777/prod/proxy`), CloudWatch dashboard `poker777-prod-loadtest`, EC2 detailed monitoring |

**ต่างจาก guide:** ไม่ต้องทำ AMI เอง — ทุกเครื่อง clone branch ที่ตั้งไว้ (ค่าเริ่ม `AlmostDone`) จาก GitHub ตอนเปิดเครื่อง → **ทดสอบโค้ดที่ push แล้วเท่านั้น** • ไม่มีโดเมน → เข้าเว็บผ่าน DNS ของ ALB แบบ HTTP • เพิ่มกฎให้ RDS Proxy ต่อ DB ได้ (guide ขาด)

---

## ส่วนที่ 1 — ติดตั้ง

### 1.1 เตรียมเครื่อง (ครั้งเดียว)

| ต้องมี | ติดตั้ง (Windows / macOS) | เช็ค |
|---|---|---|
| Terraform ≥ 1.5 | `winget install Hashicorp.Terraform` / `brew install terraform` | `terraform version` |
| Node.js ≥ 20 | `winget install OpenJS.NodeJS.LTS` / `brew install node` | `node --version` |
| Git + repo นี้ | clone แล้วอยู่ branch เดียวกับที่จะทดสอบ | `git status` |

ไม่ต้องติดตั้ง AWS CLI — Terraform และสคริปต์ทดสอบอ่าน key จากไฟล์เอง

### 1.2 ใส่ key ของ Learner Lab

1. Learner Lab → **Start Lab** (รอไฟเขียว) → **AWS Details** → AWS CLI: **Show**
2. คัดลอกไฟล์ตัวอย่างแล้ววาง key 3 ค่า:
   ```bash
   cd infra/terraform-test
   cp lab.auto.tfvars.example lab.auto.tfvars
   ```
   แก้ `lab.auto.tfvars` ใส่ `aws_access_key`, `aws_secret_key`, `aws_session_token` (ไฟล์นี้ถูก `.gitignore` — **ห้าม commit / ห้ามส่ง key ในแชท**)
3. key หมดอายุพร้อม session (สูงสุด 4 ชม.) → กด Start Lab ใหม่แล้ววาง key ชุดใหม่ทุกครั้ง

### 1.3 สร้างระบบ

```bash
cd infra/terraform-test
terraform init
terraform plan -out tf.plan      # ควรเห็น "Plan: ~79 to add, 0 to change, 0 to destroy"
terraform apply tf.plan          # 20–30 นาที (RDS + replica 3 ตัวนานสุด)
```

จบแล้วจะได้ output: `site_url` (เว็บ), `health_url`, `dashboard_url`, `db_writer`, `redis` …
เครื่อง EC2 ต้องติดตั้งต่ออีก **5–10 นาที** หลัง apply จบ (dnf, Node, npm ci, build)

### 1.4 เช็คว่าใช้ได้

```bash
cd tools/loadtest
npm ci                     # ครั้งแรกครั้งเดียว
node asg-status.mjs        # Backend 2 + Frontend 2 ต้องเป็น InService/Healthy และ target group = healthy
```

แล้วเปิด `site_url` ในเบราว์เซอร์ → สมัคร/ล็อกอิน/สร้างห้องได้ = พร้อมทดสอบ • `health_url` ต้องตอบ `{"status":"ok",...}`

---

## ส่วนที่ 2 — ทดสอบโหลด

เครื่องมืออยู่ที่ `tools/loadtest/` (รายละเอียดทุกคำสั่ง: [`tools/loadtest/README.md`](../../tools/loadtest/README.md)) — **รันทุกคำสั่งในโฟลเดอร์ `tools/loadtest`** เครื่องมืออ่าน `terraform.tfstate` และ `lab.auto.tfvars` ในโฟลเดอร์นี้เอง ไม่ต้องตั้งค่าอะไรเพิ่ม

### 2.1 สร้างบัญชีบอท (ครั้งแรก)

```bash
node aws-test.mjs --seed-bots 1000     # 1,000 บัญชีใน ~1 นาที (เขียนตรงใน DB ของระบบทดสอบ ผ่าน SSM)
```

- บัญชีถูกบันทึกใน `tools/loadtest/.bots.json` (git-ignored) พร้อม token อายุ 24 ชม. • อยากได้มากกว่านี้ รันซ้ำ (`--seed-bots 4000` = เพิ่มอีก 4,000)
- **ใช้กับระบบทดสอบนี้เท่านั้น** (ข้ามหน้าสมัคร) — ถ้าอยากทดสอบการสมัครจริงด้วย: `node loadtest.mjs --base <site_url> --bots 50 --accounts-only` (ลิมิต 10 ครั้ง/นาที/IP → ช้า)
- token หมด (เกิน 24 ชม.) → seed ใหม่ หรือบอทจะถูกข้าม

### 2.2 สูตรทดสอบ (เลือกตามคำถาม)

ก่อนทุกเทส เติมชิปให้บอท: `node aws-test.mjs --refill-bots 1000`

| อยากรู้ | คำสั่ง | เวลา | ต้องมีบอท |
|---|---|---|---|
| **ลองระบบ** (smoke) | `node aws-test.mjs --steps 10,25,50 --minutes 3 --per-room 8 --out ../../docs/loadtest/MyTest1` | ~25 นาที | 50 |
| **ความจุไล่ระดับ** (แบบ Test2–3) | `node aws-test.mjs --steps 300,700,1000 --minutes 5 --per-room 8 --browse-rps 1 --out ../../docs/loadtest/MyTest2` | ~70 นาที | 1,000 |
| **Auto Scaling + ผู้เล่นต่อเครื่อง** (แบบ Test5–6) | `node aws-test.mjs --steps 5000 --minutes 10 --per-room 8 --browse-rps 1 --seat-parallel 6 --observe-after 20 --out ../../docs/loadtest/MyTest3` | ~60 นาที | 5,000 |

- `--steps` จำนวนผู้เล่นแต่ละขั้น • `--minutes` เวลาเล่นต่อขั้น (หลังนั่งครบ) • `--per-room` คนต่อโต๊ะ • `--browse-rps` เปิดหน้ารายชื่อห้อง/ประวัติต่อวินาที (ทดสอบ read replica) • `--seat-parallel` เปิดกี่ห้องพร้อมกันตอนจัดโต๊ะ • `--observe-after` บันทึกต่อหลังจบกี่นาที (ดูการลดเครื่อง)
- อยากเห็น Auto Scaling เพิ่มเครื่องเร็ว ๆ: ใส่ `backend_cpu_target = 12` ใน `lab.auto.tfvars` แล้ว `terraform apply` ก่อนเทส (ค่าจริงควร 25–30)
- **ระหว่างเทส:** อย่าปิดคอม / อย่าให้ sleep / เน็ตต้องไม่หลุด (บอทยิงจากเครื่องนี้) • อย่ารัน 2 เทสพร้อมกัน • อย่าเอาบัญชีจริงเข้าไปเล่นปน
- เทสหยุดกลางทาง (เน็ตหลุด, ปิดเครื่อง): รันคำสั่งเดิม + `--resume true` → ทำต่อเฉพาะขั้นที่ยังไม่เสร็จ

### 2.3 ผลที่ได้ (ในโฟลเดอร์ `--out`)

| ไฟล์ | คืออะไร |
|---|---|
| `results.csv` | 1 แถวต่อขั้น — ผู้เล่น, latency p50/p95/p99, CPU, RDS, Redis, 5xx … (ทำกราฟใน Excel) |
| `stepN-*/summary.md` | ตารางสรุปของขั้นนั้น (อ่านง่ายสุด) |
| `stepN-*/*.png`, `overall/*.png` | กราฟ CloudWatch 16 แบบ (ALB, EC2, CPU รายเครื่อง, จำนวนเครื่อง, ผู้เล่นต่อเครื่อง, RDS, Redis) |
| `stepN-*/timeseries.csv` | ทุกตัวชี้วัดรายนาที |
| `stepN-*/bots-timeline.csv`, `bots.log` | สิ่งที่บอทเห็นทุก 10 วิ |
| `asg-timeline.csv`, `players-per-instance.csv` | จำนวนเครื่องทุก 30 วิ / ผู้เล่นต่อ Backend ทุก 1 นาที |
| `summary.json` | ทุกอย่าง + ขนาดตารางใน DB ก่อน/หลัง |

CloudWatch ส่งข้อมูลช้า 2–5 นาที → หลังเทสจบสัก 5 นาที วาดกราฟใหม่: `node aws-test.mjs --regraph true --out <โฟลเดอร์เดิม>`
แคปจาก Console เอง: เปิด `dashboard_url` → Custom → Absolute → ช่วงเวลาตาม `summary.md` (เลือก Local timezone)

---

## ส่วนที่ 3 — ระหว่างทาง

### อัปเดตโค้ดในระบบที่เปิดอยู่

เครื่องดึงโค้ดตอนเปิดเท่านั้น — push แล้วต้องเปลี่ยนเครื่อง:

1. push ขึ้น branch ที่ตั้งไว้ (`git_branch`)
2. ใน `lab.auto.tfvars` เปลี่ยน `code_revision = "<อะไรก็ได้ที่ใหม่ เช่น commit>"` → `terraform plan -out tf.plan` → `terraform apply tf.plan` (สร้าง launch template เวอร์ชันใหม่ ไม่แตะเครื่อง)
3. `cd tools/loadtest` → `node asg-replace.mjs --all-at-once` (เปลี่ยนทุกเครื่องพร้อมกัน ~10 นาที เว็บล่มระหว่างนั้น) หรือ `node asg-replace.mjs` (ทีละเครื่อง ~25 นาที เว็บไม่ล่ม)

> Learner Lab ไม่อนุญาต `StartInstanceRefresh` ของ Auto Scaling — จึงใช้สคริปต์นี้แทน

### ค่าที่ปรับได้ (`lab.auto.tfvars` หรือ `-var`)

| ตัวแปร | ค่าเริ่ม | |
|---|---|---|
| `git_branch` | `AlmostDone` | branch ที่ทุกเครื่อง clone |
| `code_revision` | `initial` | เปลี่ยนเมื่อต้องการให้เครื่องดึงโค้ดใหม่ (ดูด้านบน) |
| `backend_min` / `backend_max` | 2 / 4 | ขนาดกลุ่ม Backend |
| `backend_cpu_target` | 30 | กฎ Auto Scaling: รักษา CPU เฉลี่ยที่ % นี้ (Node.js ใช้ 1 core → 50 % = เต็ม) |
| `backend_scaling_warmup` | 180 | วินาทีที่เครื่องใหม่ยังไม่ถูกนับ |
| `frontend_min` / `frontend_max` | 2 / 4 | ขนาดกลุ่ม Frontend (ยังไม่มีกฎ scale) |
| `read_replica_count` | 3 | ตาม guide (ลดเหลือ 1 เพื่อประหยัดได้) |
| `instance_type`, `db_instance_class`, `redis_node_type` | t3.micro, db.t4g.micro, cache.t3.micro | ตาม guide |
| `acm_certificate_arn`, `site_domain` | ว่าง | ถ้ามีโดเมน + ใบรับรอง → HTTPS |

### Session ของ Lab หมดระหว่างทาง

key ใช้ไม่ได้ (terraform / สคริปต์ขึ้น `ExpiredToken`) แต่ระบบยังอยู่และยังคิดเงิน → Start Lab → วาง key ใหม่ใน `lab.auto.tfvars` → ทำต่อได้เลย (state อยู่ในเครื่อง)

---

## ส่วนที่ 4 — ลบทิ้ง (ทำทุกครั้งหลังทดสอบ)

```bash
cd infra/terraform-test
terraform destroy          # พิมพ์ yes • ~10–15 นาที
```

- dashboard ถูกลบด้วย — แคปกราฟก่อน (ไฟล์ .png ที่สคริปต์บันทึกไว้ยังอยู่)
- ข้อมูลใน DB (บัญชีบอท, มือที่เล่น) หายหมด → ครั้งหน้าต้อง `--seed-bots` ใหม่ และลบ `tools/loadtest/.bots.json` ส่วนของ URL เก่าทิ้งได้
- เช็คว่าไม่เหลือ: `terraform state list` ต้องว่าง

---

## แก้ปัญหา

| อาการ | สาเหตุ / ทางแก้ |
|---|---|
| `ExpiredToken` / `InvalidClientTokenId` | key หมดอายุ → Start Lab แล้ววาง key ใหม่ |
| apply ล้ม: secret `poker777/prod/backend` already exists / scheduled for deletion | มี secret ชื่อนี้ในบัญชีอยู่แล้ว (ทำมือตาม guide) → ลบใน Secrets Manager (Delete immediately) แล้ว apply ใหม่ |
| apply ล้ม: `InvalidDBInstanceState` ตอนสร้าง replica | สร้างพร้อมกันไม่ได้ → `terraform apply -parallelism=1` |
| `asg-status` เครื่อง unhealthy นานเกิน 15 นาที | ดู log ในเครื่อง: EC2 → เลือกเครื่อง → Connect → Session Manager → `sudo tail -100 /var/log/poker777-user-data.log` (Backend: `sudo journalctl -u poker777-backend -n 100`) — ส่วนมากคือลืม push / branch ผิด |
| เว็บขึ้นหน้าขาว | รีเฟรชแบบไม่ใช้ cache (Ctrl+Shift+R) — มักเป็น cache ของรอบก่อน |
| บอท `HTTP 401` / "no working saved token" | token เกิน 24 ชม. หรือระบบถูกสร้างใหม่ → `--seed-bots` ใหม่ |
| บอท `rate limited — waiting 60s` | ลิมิต 100 คำขอ/นาที/IP ของ API — ปกติ บอทรอเอง |
| เทสหยุดเพราะเน็ตหลุด | รันคำสั่งเดิม + `--resume true` |
| `StartInstanceRefresh ... explicit deny` | Learner Lab ห้าม → ใช้ `node asg-replace.mjs` |

## ข้อควรรู้

- **ห้าม commit:** `lab.auto.tfvars`, `*.tfstate` (มีรหัส DB / JWT secret), `*.tfplan`, `tools/loadtest/.bots.json` — กันไว้ใน `.gitignore` แล้ว
- ชื่อทรัพยากรขึ้นต้นด้วย `poker777-prod-` เสมอ (`frontend.sh` หา Internal ALB จากชื่อนี้) → **อย่าสร้างซ้อนกับระบบที่ทำมือในบัญชีเดียวกัน**
- `--seed-bots` / `--refill-bots` แก้ข้อมูลใน DB ตรง → ใช้กับระบบทดสอบนี้เท่านั้น ห้ามใช้กับระบบจริง
- ความจุที่ทีมวัดได้ (t3.micro): ~1,500 คน/Backend ที่ CPU 30 %, Frontend ~2,500 คน/เครื่องที่ 8 %, Redis 45 % ที่ 5,000 คน — ดู [`docs/loadtest-results.md`](../../docs/loadtest-results.md)

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | |
|---|---|
| `main.tf` | provider, ชื่อ, LabRole, AMI |
| `variables.tf` | ค่าที่ปรับได้ |
| `network.tf` | VPC, subnet, NAT, route |
| `security.tf` | Security Group (ตาม guide + RDS Proxy) |
| `data.tf` | RDS writer/replica/Proxy, Redis, Secrets Manager |
| `compute.tf` | ALB 2 ตัว, target group, launch template, ASG, กฎ Auto Scaling |
| `dashboard.tf` | CloudWatch dashboard สำหรับเทส |
| `outputs.tf` | `site_url`, endpoint ต่าง ๆ |
| `lab.auto.tfvars.example` | ตัวอย่างไฟล์ key + ค่าที่ปรับได้ |
