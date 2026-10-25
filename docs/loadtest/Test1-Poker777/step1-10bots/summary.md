# Step 1: 10 bots (5 min)

เวลา (ไทย): เริ่ม 17:47 • บอทนั่งครบ 17:47 • จบ 17:52 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 10 / 10 |
| มือที่เล่น / การกระทำ | 32 / 271 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 297 / 371 / – / 554 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | – / – / – ms / – / – |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 17.2 / 30.3 / 30.5 ms • internal ALB p95 27.4 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 25 (5.0) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 33 / 33 |
| ALB LCU (หน่วยคิดเงิน) | 0.001 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 1.0 / 1.4 % |
| Frontend CPU เฉลี่ย | 0.3 % |
| Backend network in / out | 3.6 / 3.5 MB |
| Node.js process RAM (RSS) กลางขั้น | – MB |
| เครื่อง Backend RAM ใช้ / ว่าง (จาก – MB) | – / – MB |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 5.1 / 6.4 % | 15 | 0.89 | 104 MB |
| read-1 | 4.3 / 4.9 % | 1 | 0.49 | 108 MB |
| read-2 | 4.2 / 4.5 % | 1 | 0.37 | 111 MB |
| read-3 | 4.5 / 5.2 % | 1 | 0.44 | 112 MB |

Writer: write IOPS 8.6 • write latency 0.72 ms • replica lag สูงสุด 0 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 0.63 / 0.75 % | 7.1 MB | 8.5 MB | 8 |
| poker777-prod-redis-002 | 0.44 / 0.50 % | 7.0 MB | 3.7 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Nothing to call; use CHECK":137,"Insufficient balance":8,"You must CALL or FOLD":5}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)