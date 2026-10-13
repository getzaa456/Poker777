# Step 3: 50 bots (5 min)

เวลา (ไทย): เริ่ม 18:04 • บอทนั่งครบ 18:06 • จบ 18:11 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5.1 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 50 / 50 |
| มือที่เล่น / การกระทำ | 142 / 1149 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 297 / 373 / – / 477 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | – / – / – ms / – / – |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 15.3 / 39.2 / 39.2 ms • internal ALB p95 30.5 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 7 (1.4) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 163 / 87 |
| ALB LCU (หน่วยคิดเงิน) | 0.006 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 3.0 / 3.8 % |
| Frontend CPU เฉลี่ย | 0.5 % |
| Backend network in / out | 20.0 / 18.3 MB |
| Node.js process RAM (RSS) กลางขั้น | – MB |
| เครื่อง Backend RAM ใช้ / ว่าง (จาก – MB) | – / – MB |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 4.7 / 5.1 % | 15 | 0.63 | 106 MB |
| read-1 | 4.5 / 5.0 % | 1 | 0.42 | 116 MB |
| read-2 | 4.5 / 4.7 % | 1 | 0.34 | 113 MB |
| read-3 | 4.6 / 5.6 % | 1 | 0.39 | 112 MB |

Writer: write IOPS 26.7 • write latency 0.82 ms • replica lag สูงสุด 0 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 1.53 / 1.90 % | 7.1 MB | 26.2 MB | 8 |
| poker777-prod-redis-002 | 0.89 / 1.07 % | 7.1 MB | 4.8 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Insufficient balance":32,"You must CALL or FOLD":21,"Nothing to call; use CHECK":592}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)