# Step 1: 300 bots (5 min)

เวลา (ไทย): เริ่ม 20:49 • บอทนั่งครบ 20:55 • จบ 21:00 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 300 / 300 |
| มือที่เล่น / การกระทำ | 854 / 8275 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 307 / 405 / 536 / 1416 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 298 / 263 / 280 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 10.0 / 21.1 / 63.3 ms • internal ALB p95 15.8 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 269 (53.4) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 603 / 64 |
| ALB LCU (หน่วยคิดเงิน) | 0.039 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 12.2 / 12.7 % |
| Frontend CPU เฉลี่ย | 1.5 % |
| Backend network in / out | 114.7 / 110.0 MB |
| Node.js process RAM (RSS) กลางขั้น | 130.0 MB |
| เครื่อง Backend RAM ใช้ / ว่าง (จาก 913 MB) | 307 / 458 MB |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 5.6 / 6.1 % | 15 | 0.44 | 111 MB |
| read-1 | 5.2 / 5.3 % | 1 | 0.37 | 113 MB |
| read-2 | 5.2 / 5.4 % | 1 | 0.34 | 119 MB |
| read-3 | 5.2 / 5.8 % | 1 | 0.33 | 115 MB |

Writer: write IOPS 100.4 • write latency 0.77 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 5.98 / 6.19 % | 7.2 MB | 133.9 MB | 8 |
| poker777-prod-redis-002 | 2.72 / 2.75 % | 7.2 MB | 8.6 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Nothing to call; use CHECK":4143,"Insufficient balance":253,"You must CALL or FOLD":193,"A hand is already in progress":1}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)