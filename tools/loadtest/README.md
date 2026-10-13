# tools/loadtest — บอทและเครื่องมือทดสอบโหลด Poker777

ใช้คู่กับระบบทดสอบใน [`infra/terraform-test`](../../infra/terraform-test/README.md) (ขั้นติดตั้งอยู่ในนั้น) • รันทุกคำสั่งในโฟลเดอร์นี้ • ครั้งแรก `npm ci`

ทุกสคริปต์ที่คุยกับ AWS อ่าน key จาก `infra/terraform-test/lab.auto.tfvars` และชื่อทรัพยากรจาก `infra/terraform-test/terraform.tfstate` เอง

## ไฟล์

| ไฟล์ | ทำอะไร |
|---|---|
| `aws-test.mjs` | **ตัวหลัก** — ทดสอบไล่ขั้น + เก็บตัวเลข/กราฟ CloudWatch + RAM / ผู้เล่นต่อเครื่องผ่าน SSM + ขนาด DB ก่อน/หลัง |
| `loadtest.mjs` | บอท (ถูกเรียกโดย `aws-test.mjs`; รันเองก็ได้ เช่นกับเครื่อง local) |
| `asg-status.mjs` | ดูสถานะ Auto Scaling Group, เครื่อง, health, กฎ scale, เหตุการณ์ล่าสุด (อ่านอย่างเดียว) |
| `asg-replace.mjs` | เปลี่ยนเครื่องให้ใช้ launch template ล่าสุด (แทน instance refresh ที่ Learner Lab ห้าม) |
| `db-counters.mjs` | นับ SELECT ต่อเครื่อง RDS (พิสูจน์ว่า read replica ถูกใช้) |
| `.bots.json` | บัญชีบอท + token (git-ignored, สร้างเอง) |

## `aws-test.mjs`

### ทดสอบ

```bash
node aws-test.mjs --steps 300,700,1000 --minutes 5 --per-room 8 --browse-rps 1 --out ../../docs/loadtest/MyTest
```

| ตัวเลือก | ค่าเริ่ม | ความหมาย |
|---|---|---|
| `--steps` | `10,25,50,100,150` | จำนวนผู้เล่นแต่ละขั้น (ขั้นละรอบ จัดโต๊ะใหม่ทุกขั้น) |
| `--minutes` | 5 | เวลาเล่นต่อขั้น นับหลังบอทนั่งครบ |
| `--per-room` | 6 | ผู้เล่นต่อโต๊ะ (สูงสุด 9) |
| `--browse-rps` | 0 | ระหว่างเล่น เปิดหน้ารายชื่อห้อง / ประวัติมือ / ธุรกรรม กี่ครั้งต่อวินาที (งานอ่านที่ไป read replica) |
| `--seat-parallel` | 1 | จัดโต๊ะพร้อมกันกี่ห้อง (5,000 คน: ใช้ 6 → ~16 นาที) |
| `--observe-after` | 0 | หลังขั้นสุดท้าย บันทึกต่ออีกกี่นาที (ดู Auto Scaling ลดเครื่อง ~15–20 นาที) |
| `--settle` | 180 | รอ CloudWatch กี่วินาทีก่อนดึงตัวเลขของขั้น |
| `--resume true` | — | เทสเดิมหยุดกลางทาง: เก็บขั้นที่เสร็จแล้ว ทำเฉพาะที่เหลือ (ใช้ `--steps`/`--out` เดิม) |
| `--out` | `docs/loadtest/Test1-Poker777` | โฟลเดอร์ผล |

ลำดับที่สคริปต์ทำ: baseline 5 นาทีก่อนเริ่ม → ขนาดตาราง DB → แต่ละขั้น (บอทนั่ง → เล่น → ออก → รอ CloudWatch → ตัวเลข + กราฟ 16 แบบ) → DB หลัง → กราฟรวม `overall/` • ตลอดเวลา: จำนวนเครื่องทุก 30 วิ (`asg-timeline.csv`), ผู้เล่นต่อ Backend ทุก 1 นาที (`players-per-instance.csv` + custom metric `Poker777/LoadTest › PlayerConnections`)

### โหมดอื่น

| คำสั่ง | ทำอะไร |
|---|---|
| `node aws-test.mjs --check true` | เช็คสิทธิ์ CloudWatch / SSM / Auto Scaling ก่อนเทส |
| `node aws-test.mjs --seed-bots 1000` | **เพิ่ม**บัญชีบอท 1,000 บัญชีตรงใน DB (~1 นาที) — ระบบทดสอบเท่านั้น |
| `node aws-test.mjs --refill-bots 1000` | ตั้งชิปของบอททุกตัว (`bot_*`) เป็น 1,000 — ทำก่อนทุกเทส |
| `node aws-test.mjs --regraph true --out <โฟลเดอร์>` | วาดกราฟ/คำนวณตัวเลขใหม่หลัง CloudWatch ส่งข้อมูลครบ (รอ ~5 นาทีหลังจบ) |

## `loadtest.mjs` (บอทโดยตรง)

```bash
node loadtest.mjs --base http://<site_url> --bots 50 --minutes 3 --per-room 8
node loadtest.mjs --base http://localhost:4000 --bots 20      # demo server ในเครื่อง (tools/demo-server)
node loadtest.mjs --base http://<site_url> --bots 100 --accounts-only   # สมัคร/ล็อกอินผ่านเว็บจริง (10 ครั้ง/นาที/IP)
```

ตัวเลือก: `--bots`, `--minutes`, `--per-room`, `--room <รหัส>` (เติมห้องที่มีอยู่), `--browse-rps`, `--seat-parallel`, `--reuse-only` (ใช้แต่บัญชีที่ token ยังใช้ได้ ไม่สมัครใหม่), `--accounts-only` • พิมพ์สถิติทุก 10 วิ: นั่งได้, action, มือ, latency p50/p95/p99/max, หลุด, error ที่เซิร์ฟเวอร์ปฏิเสธ

บอทแต่ละตัว: คิด 0.4–1.8 วิ แล้ว CALL / RAISE / FOLD แบบสุ่ม ถ้าเซิร์ฟเวอร์ปฏิเสธ (เช่น "Nothing to call") จะลองท่าที่ปลอดภัยกว่า — error พวกนี้เป็นกติกาเกม ไม่ใช่บัค

## `asg-replace.mjs`

```bash
node asg-replace.mjs                       # ทีละเครื่อง รอเครื่องใหม่ healthy ก่อน (~25 นาที, เว็บไม่ล่ม)
node asg-replace.mjs --all-at-once         # ทุกเครื่องพร้อมกัน (~10 นาที, เว็บล่มระหว่างนั้น)
node asg-replace.mjs --only backend        # เฉพาะกลุ่มเดียว
node asg-replace.mjs --only backend --retire   # Auto Scaling เพิ่มเครื่องใหม่ไว้แล้ว: ปิดเครื่องเก่าแล้วลดขนาดกลุ่ม
```

ใช้หลัง `terraform apply` ที่เปลี่ยน launch template (เช่นเปลี่ยน `code_revision` หลัง push) — เครื่องใหม่ clone โค้ดล่าสุดตอนเปิด

## อ่านผลให้ถูก

- **Latency ฝั่งบอทรวมระยะทางไทย ↔ us-east-1 ~260 ms เสมอ** — เวลาในระบบจริงดูจาก ALB `TargetResponseTime` (กราฟ 01)
- **CPU ของ t3.micro:** มี 2 vCPU แต่ Node.js ใช้ 1 core → **50 % = core เต็ม**
- Latency ของบอทเป็นค่าสะสมตั้งแต่มือแรก (รวมช่วงจัดโต๊ะ) — ดูแนวโน้มใน `bots-timeline.csv`
- CPU ต่ำ แต่ latency สูง = ติดรออะไรบางอย่าง (lock, DB pool) ไม่ใช่เครื่องไม่พอ (ดู Test5 vs Test6)
- ตัวอย่างการเขียนสรุป: `docs/loadtest/Test6-Poker777/README.md`

## ข้อจำกัด

ยิงจากคอมเครื่องเดียว / IP เดียว (ลิมิต API 100 คำขอ/นาที/IP — จัดโต๊ะจึงใช้เวลา) • ระยะทางไทย–US • บอทเล่นเร็วกว่าคน (โหลดต่อคนสูงกว่าจริง) • คอมต้องไม่ sleep และเน็ตต้องไม่หลุดตลอดเทส
