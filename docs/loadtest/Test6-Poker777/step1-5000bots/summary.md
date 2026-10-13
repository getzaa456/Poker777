# Step 1: 5000 bots (5 min)

เวลา (ไทย): เริ่ม 08:15 • บอทนั่งครบ 08:31 • จบ 08:41 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (10 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 5000 / 5000 |
| มือที่เล่น / การกระทำ | 29397 / 238645 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 296 / 410 / 838 / 3691 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 598 / 276 / 349 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 1 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 33.1 / 90.1 / 223.0 ms • internal ALB p95 89.3 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 617 (61.4) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 14943 / 39 |
| ALB LCU (หน่วยคิดเงิน) | 0.579 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 28.6 / 38.1 % |
| Frontend CPU เฉลี่ย | 8.3 % |
| Backend network in / out | 4093.2 / 3415.9 MB |
| i-04abefdab14e43d17: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 122.3 / 269 / 495 MB |
| i-0a5c672fa8aec8371: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 132.4 / 270 / 494 MB |
| i-0b839a24b6e98a1e2: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 144.6 / 288 / 476 MB |
| i-0d6ef943da7b035a3: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 145.4 / 277 / 487 MB |
| Backend instances ระหว่างขั้น | 2–4 เครื่อง |
| ผู้เล่น (การเชื่อมต่อ :4000) ต่อเครื่อง ตอนท้ายขั้น | i-04abefdab14e43d17 682 • i-0a5c672fa8aec8371 685 • i-0b839a24b6e98a1e2 1813 • i-0d6ef943da7b035a3 1826 |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 19.1 / 23.0 % | 41 | 2.50 | 93 MB |
| read-1 | 12.3 / 14.3 % | 4 | 2.15 | 88 MB |
| read-2 | 12.6 / 13.9 % | 4 | 2.22 | 87 MB |
| read-3 | 12.3 / 13.7 % | 4 | 1.76 | 88 MB |

Writer: write IOPS 680.9 • write latency 0.68 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 41.48 / 45.30 % | 12.6 MB | 4578.3 MB | 17 |
| poker777-prod-redis-002 | 14.33 / 15.89 % | 12.4 MB | 89.5 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Insufficient balance":6170,"You must CALL or FOLD":4815,"Nothing to call; use CHECK":125860}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [14-asg-instances](14-asg-instances.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)