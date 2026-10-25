# Step 2: 700 bots (5 min)

เวลา (ไทย): เริ่ม 21:04 • บอทนั่งครบ 21:18 • จบ 21:23 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 700 / 700 |
| มือที่เล่น / การกระทำ | 2924 / 25508 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 307 / 627 / 860 / 2602 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 297 / 255 / 269 ms / 0 / 1 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 9.8 / 20.0 / 104.2 ms • internal ALB p95 13.7 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 295 (58.5) / 1 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 2112 / 14 |
| ALB LCU (หน่วยคิดเงิน) | 0.100 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 20.6 / 21.6 % |
| Frontend CPU เฉลี่ย | 2.6 % |
| Backend network in / out | 236.6 / 244.5 MB |
| Node.js process RAM (RSS) กลางขั้น | 132.6 MB |
| เครื่อง Backend RAM ใช้ / ว่าง (จาก 913 MB) | 285 / 479 MB |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 7.2 / 8.0 % | 15 | 0.71 | 110 MB |
| read-1 | 5.9 / 6.1 % | 1 | 0.46 | 107 MB |
| read-2 | 5.9 / 6.4 % | 1 | 0.34 | 116 MB |
| read-3 | 6.0 / 6.7 % | 1 | 0.38 | 115 MB |

Writer: write IOPS 125.1 • write latency 0.69 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 10.09 / 10.63 % | 7.5 MB | 276.9 MB | 8 |
| poker777-prod-redis-002 | 4.15 / 4.53 % | 7.4 MB | 11.2 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Insufficient balance":763,"You must CALL or FOLD":589,"Nothing to call; use CHECK":13102,"A hand is already in progress":3}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)