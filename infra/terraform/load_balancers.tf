resource "aws_lb" "public" {
  name                       = "${local.name}-public"
  internal                   = false
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.public_alb.id]
  drop_invalid_header_fields = true
  idle_timeout               = 3600

  tags = { Name = "${local.name}-public" }
}

resource "aws_lb_target_group" "frontend" {
  name        = "${local.name}-frontend"
  port        = 3000
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-frontend" }
}

resource "aws_lb_target_group" "backend_public" {
  name        = "${local.name}-backend-public"
  port        = 4000
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-backend-public" }
}

resource "aws_lb_listener" "public_https" {
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener_rule" "public_websocket" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_public.arn
  }

  condition {
    path_pattern {
      values = ["/ws*"]
    }
  }
}

resource "aws_lb_listener_rule" "public_api_user" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_public.arn
  }

  condition {
    path_pattern {
      values = ["/auth*", "/users*", "/wallet*"]
    }
  }
}

resource "aws_lb_listener_rule" "public_api_tables" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 30

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_public.arn
  }

  condition {
    path_pattern {
      values = ["/tables*", "/internal*", "/health"]
    }
  }
}

resource "aws_lb_listener" "public_http" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb" "internal" {
  name                       = "${local.name}-internal"
  internal                   = true
  load_balancer_type         = "application"
  subnets                    = aws_subnet.private_app[*].id
  security_groups            = [aws_security_group.internal_alb.id]
  drop_invalid_header_fields = true
  idle_timeout               = 3600

  tags = { Name = "${local.name}-internal" }
}

resource "aws_lb_target_group" "backend" {
  name        = "${local.name}-backend"
  port        = 4000
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-backend" }
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

resource "aws_route53_record" "site" {
  zone_id = var.route53_zone_id
  name    = var.site_domain
  type    = "A"

  alias {
    name                   = aws_lb.public.dns_name
    zone_id                = aws_lb.public.zone_id
    evaluate_target_health = true
  }
}