# One CloudWatch dashboard with every graph needed for the load test (period 1 minute).
# Load balancer -> EC2 -> RDS -> Redis, top to bottom.

locals {
  pub_alb   = aws_lb.public.arn_suffix
  int_alb   = aws_lb.internal.arn_suffix
  tg_front  = aws_lb_target_group.frontend.arn_suffix
  tg_back   = aws_lb_target_group.backend.arn_suffix
  db_all    = concat([aws_db_instance.writer.identifier], local.readers[*].identifier)
  db_reads  = local.readers[*].identifier
  redis_ids = sort(tolist(aws_elasticache_replication_group.redis.member_clusters))

  # helper: one line per DB instance / Redis node
  db_lines    = { for metric in ["CPUUtilization", "CPUCreditBalance", "DatabaseConnections", "FreeableMemory"] : metric => [for id in local.db_all : ["AWS/RDS", metric, "DBInstanceIdentifier", id]] }
  redis_lines = { for metric in ["EngineCPUUtilization", "CurrConnections", "BytesUsedForCache", "NetworkBytesOut"] : metric => [for id in local.redis_ids : ["AWS/ElastiCache", metric, "CacheClusterId", id]] }

  graph = { view = "timeSeries", region = var.aws_region, period = 60, stacked = false }

  widgets = [
    { type = "text", width = 24, height = 2, properties = { markdown = "## Poker777 load test\nตั้งช่วงเวลาให้ตรงกับขั้นที่ทดสอบ (ดู summary.md ของแต่ละขั้น) • Period 1 นาที • ผู้เล่นต่อเครื่อง: metric Poker777/LoadTest › PlayerConnections" } },

    # ---------- Load balancers ----------
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Public ALB response time (seconds)", stat = "p50", metrics = [
      ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", local.pub_alb, { stat = "p50", label = "p50" }],
      ["...", { stat = "p95", label = "p95" }],
      ["...", { stat = "p99", label = "p99" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Requests and errors per minute", stat = "Sum", metrics = [
      ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", local.pub_alb, { label = "requests" }],
      [".", "HTTPCode_Target_5XX_Count", ".", ".", { label = "5xx from backend", yAxis = "right" }],
      [".", "HTTPCode_ELB_5XX_Count", ".", ".", { label = "5xx from ALB", yAxis = "right" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Open connections (1 WebSocket = 1 player)", stat = "Sum", metrics = [
      ["AWS/ApplicationELB", "ActiveConnectionCount", "LoadBalancer", local.pub_alb, { label = "public active" }],
      [".", "NewConnectionCount", ".", ".", { label = "public new" }],
      [".", "ActiveConnectionCount", ".", local.int_alb, { label = "internal active" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Internal ALB (nginx -> backend) response time", stat = "p95", metrics = [
      ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", local.int_alb, { stat = "p50", label = "p50" }],
      ["...", { stat = "p95", label = "p95" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Healthy instances", stat = "Minimum", metrics = [
      ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", local.tg_back, "LoadBalancer", local.int_alb, { label = "backend healthy" }],
      [".", "UnHealthyHostCount", ".", ".", ".", ".", { label = "backend unhealthy" }],
      [".", "HealthyHostCount", ".", local.tg_front, ".", local.pub_alb, { label = "frontend healthy" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Traffic and ALB billing units", stat = "Sum", metrics = [
      ["AWS/ApplicationELB", "ProcessedBytes", "LoadBalancer", local.pub_alb, { label = "bytes (public)" }],
      [".", "ConsumedLCUs", ".", ".", { label = "LCUs", yAxis = "right" }],
    ] }) },

    # ---------- EC2 ----------
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "EC2 CPU % (Node.js uses one core)", stat = "Average", metrics = [
      ["AWS/EC2", "CPUUtilization", "AutoScalingGroupName", aws_autoscaling_group.backend.name, { label = "backend" }],
      ["...", aws_autoscaling_group.frontend.name, { label = "frontend" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "EC2 CPU credits (t3 slows down at 0)", stat = "Minimum", metrics = [
      ["AWS/EC2", "CPUCreditBalance", "AutoScalingGroupName", aws_autoscaling_group.backend.name, { label = "backend" }],
      ["...", aws_autoscaling_group.frontend.name, { label = "frontend" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Backend network (bytes per minute)", stat = "Sum", metrics = [
      ["AWS/EC2", "NetworkIn", "AutoScalingGroupName", aws_autoscaling_group.backend.name, { label = "in" }],
      [".", "NetworkOut", ".", ".", { label = "out" }],
    ] }) },

    # ---------- Auto Scaling: how many instances, CPU of each ----------
    { type = "metric", width = 12, height = 6, properties = merge(local.graph, { title = "Instances in each Auto Scaling Group", stat = "Maximum", metrics = [
      ["AWS/AutoScaling", "GroupInServiceInstances", "AutoScalingGroupName", aws_autoscaling_group.backend.name, { label = "backend in service" }],
      [".", "GroupDesiredCapacity", ".", ".", { label = "backend desired" }],
      [".", "GroupInServiceInstances", ".", aws_autoscaling_group.frontend.name, { label = "frontend in service" }],
    ] }) },
    # SEARCH finds every instance, including ones Auto Scaling adds later (frontend instances show up too — see the id).
    { type = "metric", width = 12, height = 6, properties = merge(local.graph, { title = "CPU % per EC2 instance (backend + frontend, by instance id)", metrics = [
      [{ expression = "SEARCH('{AWS/EC2,InstanceId} MetricName=\"CPUUtilization\"', 'Average', 60)", id = "cpu", label = "" }],
    ] }) },

    # ---------- RDS ----------
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "RDS CPU %", stat = "Average", metrics = local.db_lines["CPUUtilization"] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "RDS connections (limit 10 per backend)", stat = "Maximum", metrics = local.db_lines["DatabaseConnections"] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "RDS CPU credits (t4g slows down at 0)", stat = "Minimum", metrics = local.db_lines["CPUCreditBalance"] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Writer disk: IOPS", stat = "Average", metrics = [
      ["AWS/RDS", "WriteIOPS", "DBInstanceIdentifier", aws_db_instance.writer.identifier, { label = "write IOPS" }],
      [".", "ReadIOPS", ".", ".", { label = "read IOPS" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Writer disk: latency (seconds)", stat = "Average", metrics = [
      ["AWS/RDS", "WriteLatency", "DBInstanceIdentifier", aws_db_instance.writer.identifier, { label = "write" }],
      [".", "ReadLatency", ".", ".", { label = "read" }],
    ] }) },
    { type = "metric", width = 8, height = 6, properties = merge(local.graph, { title = "Read replica lag (seconds, should stay < 1)", stat = "Maximum", metrics = [for id in local.db_reads : ["AWS/RDS", "ReplicaLag", "DBInstanceIdentifier", id]] }) },
    { type = "metric", width = 12, height = 6, properties = merge(local.graph, { title = "Writer free storage (bytes) — before vs after = data per test", stat = "Minimum", metrics = [
      ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", aws_db_instance.writer.identifier],
    ] }) },
    { type = "metric", width = 12, height = 6, properties = merge(local.graph, { title = "RDS free memory (bytes)", stat = "Minimum", metrics = local.db_lines["FreeableMemory"] }) },

    # ---------- Redis ----------
    { type = "metric", width = 6, height = 6, properties = merge(local.graph, { title = "Redis CPU %", stat = "Average", metrics = local.redis_lines["EngineCPUUtilization"] }) },
    { type = "metric", width = 6, height = 6, properties = merge(local.graph, { title = "Redis connections", stat = "Maximum", metrics = local.redis_lines["CurrConnections"] }) },
    { type = "metric", width = 6, height = 6, properties = merge(local.graph, { title = "Redis memory used (bytes)", stat = "Maximum", metrics = local.redis_lines["BytesUsedForCache"] }) },
    { type = "metric", width = 6, height = 6, properties = merge(local.graph, { title = "Redis network out (bytes)", stat = "Sum", metrics = local.redis_lines["NetworkBytesOut"] }) },
  ]
}

resource "aws_cloudwatch_dashboard" "loadtest" {
  dashboard_name = "${local.name}-loadtest"
  dashboard_body = jsonencode({ widgets = local.widgets })
}

output "dashboard_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.loadtest.dashboard_name}"
}
