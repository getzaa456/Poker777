# Step 3: 1000 bots (5 min)

เวลา (ไทย): เริ่ม 23:22 • บอทนั่งครบ 23:41 • จบ 23:46 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 1000 / 1000 |
| มือที่เล่น / การกระทำ | 4795 / 40335 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 297 / 401 / 563 / 1549 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 298 / 267 / 312 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 9.7 / 39.1 / 113.0 ms • internal ALB p95 22.1 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 297 (58.9) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 2003 / 5 |
| ALB LCU (หน่วยคิดเงิน) | 0.000 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 17.0 / 20.3 % |
| Frontend CPU เฉลี่ย | 2.3 % |
| Backend network in / out | 389.8 / 410.8 MB |
| i-033db6e8f61833238: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 133.9 / 284 / 480 MB |
| i-0bb4baf020f2c86f5: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 133.4 / 269 / 495 MB |
| Backend instances ระหว่างขั้น | 2–2 เครื่อง |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 8.0 / 8.7 % | 24 | 0.61 | 124 MB |
| read-1 | 6.3 / 7.0 % | 2 | 0.32 | 132 MB |
| read-2 | 6.3 / 7.1 % | 2 | 0.33 | 129 MB |
| read-3 | 6.3 / 7.2 % | 2 | 0.34 | 132 MB |

Writer: write IOPS 145.1 • write latency 0.68 ms • replica lag สูงสุด 0 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 16.85 / 17.37 % | 7.7 MB | 478.2 MB | 11 |
| poker777-prod-redis-002 | 7.10 / 7.28 % | 7.6 MB | 20.3 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Nothing to call; use CHECK":21122,"Insufficient balance":1100,"You must CALL or FOLD":876,"A hand is already in progress":2}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [14-asg-instances](14-asg-instances.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)