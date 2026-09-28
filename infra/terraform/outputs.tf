output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_alb_dns_name" {
  value = aws_lb.public.dns_name
}

output "internal_alb_dns_name" {
  value = aws_lb.internal.dns_name
}

output "frontend_asg_name" {
  value = aws_autoscaling_group.frontend.name
}

output "backend_asg_name" {
  value = aws_autoscaling_group.backend.name
}

output "backend_target_group_arn" {
  value = aws_lb_target_group.backend.arn
}

output "frontend_ecr_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "backend_ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "rds_writer_endpoint" {
  value = aws_db_instance.writer.address
}

output "rds_master_secret_arn" {
  value     = aws_db_instance.writer.master_user_secret[0].secret_arn
  sensitive = true
}

output "rds_reader_endpoints" {
  value = aws_db_instance.reader[*].address
}

output "elasticache_primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "site_url" {
  value = "https://${var.site_domain}"
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}