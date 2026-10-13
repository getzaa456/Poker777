output "site_url" {
  description = "Open this in a browser once both target groups are healthy (5-8 minutes after apply)"
  value       = var.acm_certificate_arn != "" ? "https://${aws_lb.public.dns_name}" : "http://${aws_lb.public.dns_name}"
}

output "health_url" {
  value = "${var.acm_certificate_arn != "" ? "https" : "http"}://${aws_lb.public.dns_name}/health"
}

output "internal_alb" {
  value = aws_lb.internal.dns_name
}

output "db_writer" {
  value = aws_db_instance.writer.address
}

output "db_readers" {
  value = local.readers[*].address
}

output "db_proxy" {
  description = "Created per the guide, but DB_HOST points at the writer directly (as in the guide)"
  value       = aws_db_proxy.main.endpoint
}

output "redis" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "check_target_health" {
  description = "Run in AWS CloudShell to see whether the instances are up"
  value       = "aws elbv2 describe-target-health --target-group-arn ${aws_lb_target_group.backend.arn} && aws elbv2 describe-target-health --target-group-arn ${aws_lb_target_group.frontend.arn}"
}
