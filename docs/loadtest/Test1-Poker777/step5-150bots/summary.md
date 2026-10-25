# Step 5: 150 bots (5 min)

เวลา (ไทย): เริ่ม 18:26 • บอทนั่งครบ 18:31 • จบ 18:36 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5.1 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 150 / 150 |
| มือที่เล่น / การกระทำ | 477 / 4215 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 298 / 376 / – / 947 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | – / – / – ms / – / – |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 14.6 / 16.2 / 16.3 ms • internal ALB p95 13.0 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 7 (1.4) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 344 / 104 |
| ALB LCU (หน่วยคิดเงิน) | 0.017 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 7.6 / 8.5 % |
| Frontend CPU เฉลี่ย | 1.0 % |
| Backend network in / out | 65.3 / 58.7 MB |
| Node.js process RAM (RSS) กลางขั้น | – MB |
| เครื่อง Backend RAM ใช้ / ว่าง (จาก – MB) | – / – MB |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 5.4 / 5.8 % | 15 | 0.70 | 107 MB |
| read-1 | 5.2 / 5.7 % | 1 | 0.46 | 108 MB |
| read-2 | 5.0 / 5.5 % | 1 | 0.38 | 113 MB |
| read-3 | 5.1 / 5.8 % | 1 | 0.07 | 117 MB |

Writer: write IOPS 76.5 • write latency 0.80 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 3.98 / 4.38 % | 7.1 MB | 78.7 MB | 8 |
| poker777-prod-redis-002 | 1.92 / 2.05 % | 7.1 MB | 7.3 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Insufficient balance":112,"You must CALL or FOLD":79,"Nothing to call; use CHECK":2203}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)