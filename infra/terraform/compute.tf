data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "frontend" {
  name               = "${local.name}-frontend"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role" "backend" {
  name               = "${local.name}-backend"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "frontend_ssm" {
  role       = aws_iam_role.frontend.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "backend_ssm" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "frontend" {
  name = "${local.name}-frontend-runtime-access"
  role = aws_iam_role.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = [aws_ecr_repository.frontend.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${aws_cloudwatch_log_group.frontend.name}:*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "backend" {
  name = "${local.name}-backend-runtime-access"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = [aws_ecr_repository.backend.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.backend_secret_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${aws_cloudwatch_log_group.backend.name}:*"
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "frontend" {
  name = "${local.name}-frontend"
  role = aws_iam_role.frontend.name
}

resource "aws_iam_instance_profile" "backend" {
  name = "${local.name}-backend"
  role = aws_iam_role.backend.name
}

resource "aws_launch_template" "frontend" {
  name_prefix   = "${local.name}-frontend-"
  image_id      = data.aws_ssm_parameter.al2023_ami.value
  instance_type = var.frontend_instance_type
  user_data = base64encode(templatefile("${path.module}/templates/frontend-user-data.sh.tftpl", {
    aws_region           = var.aws_region
    ecr_registry         = split("/", aws_ecr_repository.frontend.repository_url)[0]
    image_uri            = "${aws_ecr_repository.frontend.repository_url}:${var.frontend_image_tag}"
    backend_internal_dns = aws_lb.internal.dns_name
    log_group            = aws_cloudwatch_log_group.frontend.name
  }))

  iam_instance_profile { name = aws_iam_instance_profile.frontend.name }

  vpc_security_group_ids = [aws_security_group.frontend.id]

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 20
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${local.name}-frontend" }
  }
}

resource "aws_launch_template" "backend" {
  name_prefix   = "${local.name}-backend-"
  image_id      = data.aws_ssm_parameter.al2023_ami.value
  instance_type = var.backend_instance_type
  user_data = base64encode(templatefile("${path.module}/templates/backend-user-data.sh.tftpl", {
    aws_region         = var.aws_region
    ecr_registry       = split("/", aws_ecr_repository.backend.repository_url)[0]
    image_uri          = "${aws_ecr_repository.backend.repository_url}:${var.backend_image_tag}"
    backend_secret_arn = var.backend_secret_arn
    site_origin        = "https://${var.site_domain}"
    db_writer_endpoint = aws_db_instance.writer.address
    redis_endpoint     = aws_elasticache_replication_group.main.primary_endpoint_address
    log_group          = aws_cloudwatch_log_group.backend.name
  }))

  iam_instance_profile { name = aws_iam_instance_profile.backend.name }

  vpc_security_group_ids = [aws_security_group.backend.id]

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 20
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${local.name}-backend" }
  }
}

resource "aws_autoscaling_group" "frontend" {
  name                      = "${local.name}-frontend"
  min_size                  = var.frontend_min_size
  desired_capacity          = var.frontend_desired_capacity
  max_size                  = var.frontend_max_size
  vpc_zone_identifier       = aws_subnet.public[*].id
  target_group_arns         = [aws_lb_target_group.frontend.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 300
  wait_for_capacity_timeout = "0"

  launch_template {
    id      = aws_launch_template.frontend.id
    version = aws_launch_template.frontend.latest_version
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
      instance_warmup        = 300
    }
  }

  dynamic "tag" {
    for_each = merge(local.common_tags, { Name = "${local.name}-frontend" })
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

resource "aws_autoscaling_group" "backend" {
  name                      = "${local.name}-backend"
  min_size                  = var.backend_min_size
  desired_capacity          = var.backend_desired_capacity
  max_size                  = var.backend_max_size
  vpc_zone_identifier       = aws_subnet.private_app[*].id
  target_group_arns         = [aws_lb_target_group.backend.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 300
  wait_for_capacity_timeout = "0"

  launch_template {
    id      = aws_launch_template.backend.id
    version = aws_launch_template.backend.latest_version
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
      instance_warmup        = 300
    }
  }

  dynamic "tag" {
    for_each = merge(local.common_tags, { Name = "${local.name}-backend" })
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

resource "aws_autoscaling_policy" "frontend_cpu" {
  name                   = "${local.name}-frontend-cpu"
  autoscaling_group_name = aws_autoscaling_group.frontend.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 55
  }
}

resource "aws_autoscaling_policy" "backend_cpu" {
  name                   = "${local.name}-backend-cpu"
  autoscaling_group_name = aws_autoscaling_group.backend.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 55
  }
}