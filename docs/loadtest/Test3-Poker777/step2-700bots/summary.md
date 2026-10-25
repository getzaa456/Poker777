# Step 2: 700 bots (5 min)

เวลา (ไทย): เริ่ม 22:53 • บอทนั่งครบ 23:07 • จบ 23:12 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 700 / 700 |
| มือที่เล่น / การกระทำ | 2889 / 24586 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 294 / 396 / 526 / 1503 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 298 / 259 / 281 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 9.4 / 18.3 / 76.9 ms • internal ALB p95 12.5 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 293 (58.1) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 1874 / 18 |
| ALB LCU (หน่วยคิดเงิน) | 0.102 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 14.2 / 16.9 % |
| Frontend CPU เฉลี่ย | 1.9 % |
| Backend network in / out | 296.7 / 316.2 MB |
| i-033db6e8f61833238: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 130.5 / 280 / 484 MB |
| i-0bb4baf020f2c86f5: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 123.2 / 247 / 518 MB |
| Backend instances ระหว่างขั้น | 2–2 เครื่อง |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 7.0 / 7.3 % | 22 | 0.48 | 140 MB |
| read-1 | 5.8 / 6.3 % | 2 | 0.28 | 138 MB |
| read-2 | 5.7 / 6.0 % | 2 | 0.27 | 133 MB |
| read-3 | 5.9 / 7.0 % | 2 | 0.29 | 132 MB |

Writer: write IOPS 119.8 • write latency 0.70 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 14.53 / 15.05 % | 7.6 MB | 371.9 MB | 11 |
| poker777-prod-redis-002 | 6.55 / 6.72 % | 7.4 MB | 18.4 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Nothing to call; use CHECK":12719,"Insufficient balance":728,"You must CALL or FOLD":564,"A hand is already in progress":2}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [14-asg-instances](14-asg-instances.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)