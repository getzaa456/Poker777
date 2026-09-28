resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-cache"
  subnet_ids = aws_subnet.private_data[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name}-redis"
  description          = "Poker777 shared game state and Pub/Sub"
  engine               = "redis"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  port                 = 6379

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  cluster_mode               = "disabled"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.cache.id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = var.redis_auth_token
  auth_token_update_strategy = var.redis_auth_token == null ? null : "ROTATE"

  snapshot_retention_limit   = var.redis_snapshot_retention_days
  snapshot_window            = "05:00-06:00"
  maintenance_window         = "sun:06:00-sun:07:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = { Name = "${local.name}-redis" }
}