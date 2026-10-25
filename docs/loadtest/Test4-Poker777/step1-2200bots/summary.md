# Step 1: 2200 bots (5 min)

เวลา (ไทย): เริ่ม 04:17 • บอทนั่งครบ 05:03 • จบ 05:12 — ตัวเลข CloudWatch วัดช่วง "นั่งครบ → จบ" (9 นาที)

## ผู้เล่น (ฝั่งบอท)

| | |
|---|---|
| นั่งได้ | 2008 / 2200 |
| มือที่เล่น / การกระทำ | – / – |
| Latency เกม p50 / p95 / p99 / max (รวมระยะทางไทย↔US ~260 ms) | – / – / – / – ms |
| เปิดหน้ารายชื่อห้อง/ประวัติ (อ่านจาก replica): ครั้ง / p50 / p95 / โดนลิมิต / ล้ม | – / – / – ms / – / – |
| หลุดการเชื่อมต่อ | – |

## Load balancer

| | |
|---|---|
| Response time p50 / p95 / p99 (REST, เวลาใน AWS) | 54.6 / 58.4 / 58.6 ms • internal ALB p95 54.3 ms |
| Requests (ต่อนาที) / 5xx / 4xx | 45946 (5119.8) / 43907 / 0 |
| Connections เปิดค้างสูงสุด / ใหม่ทั้งหมด | 4119 / 96156 |
| ALB LCU (หน่วยคิดเงิน) | 0.000 |

## EC2

| | |
|---|---|
| Backend CPU เฉลี่ย / สูงสุด (50 % = 1 core เต็ม) | 15.7 / 17.6 % |
| Frontend CPU เฉลี่ย | 4.6 % |
| Backend network in / out | 825.8 / 1237.9 MB |
| i-033db6e8f61833238: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 156.1 / 282 / 481 MB |
| i-0bb4baf020f2c86f5: Node.js RAM (RSS) / เครื่องใช้ / ว่าง (จาก 913 MB) กลางขั้น | 154.3 / 284 / 480 MB |
| Backend instances ระหว่างขั้น | 2–2 เครื่อง |
| ผู้เล่น (การเชื่อมต่อ :4000) ต่อเครื่อง ตอนท้ายขั้น | i-033db6e8f61833238 1001 • i-0bb4baf020f2c86f5 1002 |

## RDS

| เครื่อง | CPU เฉลี่ย / สูงสุด | Connections สูงสุด | Read IOPS เฉลี่ย | Free memory ต่ำสุด |
|---|---|---|---|---|
| writer | 6.7 / 7.6 % | 25 | 0.60 | 124 MB |
| read-1 | 5.3 / 5.8 % | 2 | 0.33 | 125 MB |
| read-2 | 5.4 / 6.1 % | 2 | 0.35 | 130 MB |
| read-3 | 5.3 / 6.2 % | 2 | 0.37 | 123 MB |

Writer: write IOPS 125.5 • write latency 0.74 ms • replica lag สูงสุด 1 s

## Redis

| node | CPU เฉลี่ย / สูงสุด | Memory | Network out | Connections |
|---|---|---|---|---|
| poker777-prod-redis-001 | 12.49 / 13.04 % | 8.6 MB | 1038.9 MB | 12 |
| poker777-prod-redis-002 | 3.74 / 4.10 % | 8.4 MB | 33.1 MB | 6 |

Bot errors (คำสั่งผิดกติกาที่เซิร์ฟเวอร์ปฏิเสธ): `–`

ไฟล์: [01-alb-response-time](01-alb-response-time.png) • [02-alb-requests-errors](02-alb-requests-errors.png) • [03-alb-connections](03-alb-connections.png) • [04-ec2-cpu](04-ec2-cpu.png) • [05-ec2-network](05-ec2-network.png) • [06-rds-cpu](06-rds-cpu.png) • [07-rds-connections](07-rds-connections.png) • [08-rds-writer-disk](08-rds-writer-disk.png) • [09-rds-replica-lag](09-rds-replica-lag.png) • [10-rds-read-traffic](10-rds-read-traffic.png) • [11-rds-memory](11-rds-memory.png) • [12-redis-cpu-connections](12-redis-cpu-connections.png) • [13-redis-memory-network](13-redis-memory-network.png) • [14-asg-instances](14-asg-instances.png) • [timeseries.csv](timeseries.csv) • [bots-timeline.csv](bots-timeline.csv) • [backend-sample.txt](backend-sample.txt)