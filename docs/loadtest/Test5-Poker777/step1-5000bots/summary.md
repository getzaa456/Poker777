# Step 1: 5000 bots (5 min)

เวลา (ไทย): เริ่ม 06:13 • บอทนั่งครบ 06:38 • จบ 06:49 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (10 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 4947 / 5000 |
| มือที่เล่น / การกระทำ | 13432 / 121183 |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | 1317 / 8328 / 13768 / 35914 ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | 596 / 348 / 595 ms / 0 / 0 |
| หลุดการเชื่อมต่อ | 0 |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 144.0 / 515.6 / 752.7 ms • internal ALB p95 515.6 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 5564 (554.0) / 0 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 10995 / 344 |
| ALB LCU (หน่วยคิดเงิน) | 0.675 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 11.6 / 13.8 % |
| Frontend CPU เฉลี่ย | 3.0 % |
| Backend network in / out | 1757.4 / 1667.2 MB |
| i-01f572e5dda9cdbb5: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 130.8 / 265 / 499 MB |
| i-09156e90dc13c32fd: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 139.8 / 284 / 479 MB |
| i-0c62dedc26b19217a: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 130.1 / 261 / 503 MB |
| i-0da94de41b7a9f546: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 138.9 / 262 / 501 MB |
| Backend instances ระหว่างขั้น | 2–4 เครื่อง |
| ผู้เล่น (การเชื่อมต่อ :4000) ต่อเครื่อง ตอนท้ายขั้น | i-01f572e5dda9cdbb5 676 • i-09156e90dc13c32fd 1805 • i-0c62dedc26b19217a 681 • i-0da94de41b7a9f546 1791 |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 8.4 / 10.0 % | 45 | 0.89 | 107 MB |
| read-1 | 6.4 / 7.3 % | 4 | 0.55 | 103 MB |
| read-2 | 6.4 / 7.0 % | 4 | 0.55 | 102 MB |
| read-3 | 6.6 / 7.6 % | 4 | 0.68 | 103 MB |

Writer: write IOPS 193.0 • write latency 0.70 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 13.15 / 14.08 % | 10.6 MB | 1896.1 MB | 17 |
| poker777-prod-redis-002 | 3.03 / 3.30 % | 10.2 MB | 30.8 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `{"Insufficient balance":3970,"You must CALL or FOLD":3132,"Nothing to call; use CHECK":61756,"Not your turn":2636,"Room is busy":3053,"You cannot act in this hand":1981,"A hand is already in progress":198,"There is no active hand":522,"Minimum raise is 20":12,"Bet must be positive and made before betting":39,"Minimum raise is 30":1}`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [14-asg-instances](14-asg-instances.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)