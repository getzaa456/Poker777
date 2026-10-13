# Guide steps 12-16: target groups, public + internal ALB, launch templates, Auto Scaling Groups.
#
# Difference from the guide: instead of baking an AMI by hand, each instance runs the repo's
# script at boot (it clones branch AlmostDone from GitHub). So whatever is pushed is what runs,
# and a new instance takes ~5-8 minutes before it turns healthy.

# ---------- Target groups ----------

resource "aws_lb_target_group" "frontend" {
  name                 = "${local.name}-frontend"
  port                 = 3000
  protocol             = "HTTP"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_lb_target_group" "backend" {
  name     = "${local.name}-backend"
  port     = 4000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
  # When scaling in removes an instance, give in-flight actions time to finish; the web client then
  # reconnects to another instance (game state lives in Redis, the seat is held 30 s).
  deregistration_delay = 60
  health_check {
    path                = "/health"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

# ---------- Load balancers ----------

resource "aws_lb" "public" {
  name               = "${local.name}-public"
  load_balancer_type = "application"
  internal           = false
  subnets            = [aws_subnet.this["public-1"].id, aws_subnet.this["public-2"].id]
  security_groups    = [aws_security_group.this["public-alb"].id]
  idle_timeout       = 120
}

# No certificate: serve the site on plain HTTP (ALB DNS name).
resource "aws_lb_listener" "public_http" {
  count             = var.acm_certificate_arn == "" ? 1 : 0
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# With a certificate (guide 13): 80 redirects to 443.
resource "aws_lb_listener" "public_redirect" {
  count             = var.acm_certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "public_https" {
  count             = var.acm_certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb" "internal" {
  name               = "${local.name}-internal" # frontend.sh looks the ALB up by this name
  load_balancer_type = "application"
  internal           = true
  subnets            = [aws_subnet.this["app-1"].id, aws_subnet.this["app-2"].id]
  security_groups    = [aws_security_group.this["internal-alb"].id]
  idle_timeout       = 120
}

resource "aws_lb_listener" "internal" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 4000
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

# ---------- Launch templates (guide 15) ----------

resource "aws_launch_template" "backend" {
  name_prefix            = "${local.name}-backend-"
  image_id               = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.this["backend"].id]
  iam_instance_profile { name = "LabInstanceProfile" }
  # the repo's own boot script, cloning var.git_branch instead of the branch written in the file
  user_data = base64encode(replace(file("${path.module}/../../backend/ec2-user-data.sh"), "BRANCH=AlmostDone", "BRANCH=${var.git_branch}"))
  monitoring { enabled = true } # 1-minute CPU: the scaling rule reacts in ~3 minutes instead of ~15
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${local.name}-backend", CodeRevision = var.code_revision }
  }
}

resource "aws_launch_template" "frontend" {
  name_prefix            = "${local.name}-frontend-"
  image_id               = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.this["frontend"].id]
  iam_instance_profile { name = "LabInstanceProfile" }
  user_data = base64encode(replace(file("${path.module}/../../frontend/frontend.sh"), "BRANCH=AlmostDone", "BRANCH=${var.git_branch}"))
  monitoring { enabled = true }
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${local.name}-frontend", CodeRevision = var.code_revision }
  }
}

# ---------- Auto Scaling Groups (guide 16) ----------
# Private subnets with a NAT route: the boot script needs the internet (dnf, npm, GitHub).

resource "aws_autoscaling_group" "backend" {
  name                      = "${local.name}-backend"
  min_size                  = var.backend_min
  desired_capacity          = var.backend_min
  max_size                  = var.backend_max
  vpc_zone_identifier       = [aws_subnet.this["app-1"].id, aws_subnet.this["app-2"].id]
  target_group_arns         = [aws_lb_target_group.backend.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 900 # first boot installs Node, clones and runs migrate
  launch_template {
    id      = aws_launch_template.backend.id
    version = aws_launch_template.backend.latest_version
  }
  # Group size metrics (GroupInServiceInstances …) for the dashboard / test graphs.
  enabled_metrics     = ["GroupDesiredCapacity", "GroupInServiceInstances", "GroupPendingInstances", "GroupTerminatingInstances", "GroupTotalInstances"]
  metrics_granularity = "1Minute"
  # The scaling policy owns the instance count once the group exists.
  lifecycle {
    ignore_changes = [desired_capacity]
  }
  # The secret must be complete before the first instance reads it.
  depends_on = [
    aws_secretsmanager_secret_version.backend,
    aws_db_instance.reader_1,
    aws_db_instance.reader_2,
    aws_db_instance.reader_3,
    aws_route_table_association.private,
  ]
}

resource "aws_autoscaling_group" "frontend" {
  name                      = "${local.name}-frontend"
  min_size                  = var.frontend_min
  desired_capacity          = var.frontend_min
  max_size                  = var.frontend_max
  vpc_zone_identifier       = [aws_subnet.this["frontend-1"].id, aws_subnet.this["frontend-2"].id]
  target_group_arns         = [aws_lb_target_group.frontend.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 900 # first boot runs npm ci + vite build
  launch_template {
    id      = aws_launch_template.frontend.id
    version = aws_launch_template.frontend.latest_version
  }
  # frontend.sh looks up the internal ALB by name when it boots.
  depends_on = [aws_lb_listener.internal, aws_route_table_association.private]
}

# ---------- Auto Scaling rule (backend) ----------
# Target tracking on average CPU. Node.js runs on one core of the t3.micro's two vCPUs, so the
# metric tops out near 50 % — the target must sit well below that (load tests: 1,000 players ≈ 25 %).
resource "aws_autoscaling_policy" "backend_cpu" {
  name                      = "Target Tracking Policy"
  autoscaling_group_name    = aws_autoscaling_group.backend.name
  policy_type               = "TargetTrackingScaling"
  estimated_instance_warmup = var.backend_scaling_warmup
  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value     = var.backend_cpu_target
    disable_scale_in = false
  }
}

