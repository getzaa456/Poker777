# Guide steps 1, 10, 11: secrets, RDS MySQL (writer + read replicas + proxy), ElastiCache Redis.
# Passwords/keys are generated here; they live only in Secrets Manager and the local state file.

resource "random_password" "db" {
  length           = 28
  override_special = "!#%^*-_=+" # RDS rejects / @ " and spaces
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "random_password" "internal_key" {
  length  = 32
  special = false
}

# ---------- RDS ----------

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-subnet"
  subnet_ids = [aws_subnet.this["data-1"].id, aws_subnet.this["data-2"].id]
}

resource "aws_db_instance" "writer" {
  identifier                   = "${local.name}-writer"
  engine                       = "mysql"
  engine_version               = "8.0"
  instance_class               = var.db_instance_class
  storage_type                 = "gp3"
  allocated_storage            = 50
  max_allocated_storage        = 100
  db_name                      = "poker777"
  username                     = "pokeradmin"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.this["database"].id]
  availability_zone            = local.azs[0]
  publicly_accessible          = false
  backup_retention_period      = 1 # read replicas need automated backups on the source
  skip_final_snapshot          = true
  deletion_protection          = false
  apply_immediately            = true
  performance_insights_enabled = false
}

# Guide 10.39-10.44: read-1 in AZ a, read-2/3 in AZ b.
# One at a time: RDS refuses a new replica while the writer is still busy with the previous one
# ("DB instance is not in the available state"), so each replica waits for the one before it.
locals {
  replica_common = {
    instance_class = var.db_instance_class
    sg             = [aws_security_group.this["database"].id]
  }
}

resource "aws_db_instance" "reader_1" {
  count                        = var.read_replica_count >= 1 ? 1 : 0
  identifier                   = "${local.name}-read-1"
  replicate_source_db          = aws_db_instance.writer.identifier
  instance_class               = local.replica_common.instance_class
  storage_type                 = "gp3"
  max_allocated_storage        = 100
  vpc_security_group_ids       = local.replica_common.sg
  availability_zone            = local.azs[0]
  publicly_accessible          = false
  skip_final_snapshot          = true
  deletion_protection          = false
  apply_immediately            = true
  performance_insights_enabled = false
}

resource "aws_db_instance" "reader_2" {
  count                        = var.read_replica_count >= 2 ? 1 : 0
  identifier                   = "${local.name}-read-2"
  replicate_source_db          = aws_db_instance.writer.identifier
  instance_class               = local.replica_common.instance_class
  storage_type                 = "gp3"
  max_allocated_storage        = 100
  vpc_security_group_ids       = local.replica_common.sg
  availability_zone            = local.azs[1]
  publicly_accessible          = false
  skip_final_snapshot          = true
  deletion_protection          = false
  apply_immediately            = true
  performance_insights_enabled = false
  depends_on                   = [aws_db_instance.reader_1]
}

resource "aws_db_instance" "reader_3" {
  count                        = var.read_replica_count >= 3 ? 1 : 0
  identifier                   = "${local.name}-read-3"
  replicate_source_db          = aws_db_instance.writer.identifier
  instance_class               = local.replica_common.instance_class
  storage_type                 = "gp3"
  max_allocated_storage        = 100
  vpc_security_group_ids       = local.replica_common.sg
  availability_zone            = local.azs[1]
  publicly_accessible          = false
  skip_final_snapshot          = true
  deletion_protection          = false
  apply_immediately            = true
  performance_insights_enabled = false
  depends_on                   = [aws_db_instance.reader_2]
}

locals {
  readers = concat(aws_db_instance.reader_1, aws_db_instance.reader_2, aws_db_instance.reader_3)
}

resource "aws_secretsmanager_secret" "proxy" {
  name                    = "poker777/prod/proxy"
  description             = "Access to poker777-prod-writer"
  recovery_window_in_days = 0 # delete immediately on destroy so the name can be reused
}

resource "aws_secretsmanager_secret_version" "proxy" {
  secret_id     = aws_secretsmanager_secret.proxy.id
  secret_string = jsonencode({ username = "pokeradmin", password = random_password.db.result })
}

resource "aws_db_proxy" "main" {
  name                   = "${local.name}-proxy"
  engine_family          = "MYSQL"
  role_arn               = data.aws_iam_role.lab.arn
  vpc_subnet_ids         = [aws_subnet.this["data-1"].id, aws_subnet.this["data-2"].id]
  vpc_security_group_ids = [aws_security_group.this["proxy"].id]
  require_tls            = false
  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.proxy.arn
  }
  depends_on = [aws_secretsmanager_secret_version.proxy]
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name
}

resource "aws_db_proxy_target" "writer" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.writer.identifier
}

# ---------- Redis ----------

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-cache"
  subnet_ids = [aws_subnet.this["data-1"].id, aws_subnet.this["data-2"].id]
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name}-redis"
  description                = "Poker777 game state, timers and pub/sub"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2 # primary in AZ a, replica in AZ b
  automatic_failover_enabled = true
  multi_az_enabled           = true
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.this["cache"].id]
  transit_encryption_enabled = true # backend connects with REDIS_TLS=true
  at_rest_encryption_enabled = true
  apply_immediately          = true
}

# ---------- Backend secret (guide step 1, values filled in from what was just built) ----------

locals {
  public_origins = compact([
    var.acm_certificate_arn != "" ? "https://${aws_lb.public.dns_name}" : "http://${aws_lb.public.dns_name}",
    var.site_domain != "" ? "https://${var.site_domain}" : "",
  ])
}

resource "aws_secretsmanager_secret" "backend" {
  name                    = "poker777/prod/backend" # ec2-user-data.sh reads exactly this name
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "backend" {
  secret_id = aws_secretsmanager_secret.backend.id
  secret_string = jsonencode({
    DB_USER              = "pokeradmin"
    DB_PASSWORD          = random_password.db.result
    JWT_SECRET           = random_password.jwt.result
    INTERNAL_API_KEY     = random_password.internal_key.result
    PORT                 = "4000"
    NODE_ENV             = "production"
    TRUST_PROXY_HOPS     = "3"
    CORS_ALLOWED_ORIGINS = join(",", local.public_origins)
    DB_HOST              = aws_db_instance.writer.address
    DB_READ_HOSTS        = join(",", local.readers[*].address)
    DB_PORT              = "3306"
    DB_NAME              = "poker777"
    DB_CONNECTION_LIMIT  = "10"
    REDIS_HOST           = aws_elasticache_replication_group.redis.primary_endpoint_address
    REDIS_PORT           = "6379"
    REDIS_KEY_PREFIX     = "poker:"
    REDIS_TLS            = "true"
    JWT_EXPIRES_IN       = "24h"
    JWT_ISSUER           = "poker777"
    WELCOME_BONUS        = "1000"
  })
}
