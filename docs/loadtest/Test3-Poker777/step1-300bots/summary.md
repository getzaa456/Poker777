# Step 1: 300 bots (5 min)

เวลา (ไทย): เริ่ม 22:39 • บอทนั่งครบ 22:45 • จบ 22:50 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (5 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 300 / 300 |
| มือที่เล่น / การกระทำ | 898 / 8597 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 288 / 386 / 459 / 1505 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 298 / 258 / 283 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 9.8 / 16.7 / 43.5 ms • internal ALB p95 12.1 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 265 (52.6) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 810 / 69 |
| ALB LCU (หน่วยคิดเงิน) | 0.039 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 9.9 / 10.9 % |
| Frontend CPU เฉลี่ย | 1.1 % |
| Backend network in / out | 163.6 / 179.2 MB |
| i-033db6e8f61833238: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 130.5 / 280 / 484 MB |
| i-0bb4baf020f2c86f5: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 118.8 / 245 / 519 MB |
| Backend instances ระหว่างขั้น | 2–2 เครื่อง |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 5.8 / 6.2 % | 21 | 0.35 | 137 MB |
| read-1 | 5.1 / 5.7 % | 2 | 0.31 | 151 MB |
| read-2 | 5.2 / 5.7 % | 2 | 0.29 | 140 MB |
| read-3 | 5.4 / 6.5 % | 2 | 0.35 | 120 MB |

Writer: write IOPS 104.0 • write latency 0.82 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 10.90 / 11.13 % | 7.3 MB | 216.8 MB | 11 |
| poker777-prod-redis-002 | 5.32 / 5.44 % | 7.2 MB | 15.3 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Nothing to call; use CHECK":4216,"Insufficient balance":267,"You must CALL or FOLD":183,"A hand is already in progress":1}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [14-asg-instances](14-asg-instances.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)