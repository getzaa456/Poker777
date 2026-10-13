# Step 3: 1000 bots (5 min)

เวลา (ไทย): เริ่ม 21:26 • บอทนั่งครบ 21:45 • จบ 21:50 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 1000 / 1000 |
| มือที่เล่น / การกระทำ | 4883 / 40598 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 308 / 417 / 661 / 1995 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 298 / 261 / 301 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 13.5 / 22.4 / 114.9 ms • internal ALB p95 22.1 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 255 (50.6) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 2498 / 94 |
| ALB LCU (หน่วยคิดเงิน) | 0.000 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 24.6 / 25.3 % |
| Frontend CPU เฉลี่ย | 3.3 % |
| Backend network in / out | 311.6 / 330.0 MB |
| Node.js process RAM (RSS) กลางขั้น | 135.9 MB |
| เครื่อง Backend RAM ใช้ / ว่าง (จาก 913 MB) | 293 / 471 MB |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 8.0 / 9.1 % | 15 | 0.60 | 111 MB |
| read-1 | 6.2 / 7.5 % | 1 | 0.41 | 107 MB |
| read-2 | 6.3 / 7.0 % | 1 | 0.44 | 109 MB |
| read-3 | 6.4 / 7.9 % | 1 | 0.41 | 117 MB |

Writer: write IOPS 152.5 • write latency 0.68 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 12.10 / 12.50 % | 7.6 MB | 363.1 MB | 8 |
| poker777-prod-redis-002 | 4.76 / 5.05 % | 7.6 MB | 12.9 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Nothing to call; use CHECK":21281,"Insufficient balance":1072,"You must CALL or FOLD":825}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)