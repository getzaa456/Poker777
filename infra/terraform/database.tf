resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private_data[*].id

  tags = { Name = "${local.name}-db" }
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-mysql"
  family = var.db_parameter_group_family

  parameter {
    name         = "character_set_server"
    value        = "utf8mb4"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "writer" {
  identifier                  = "${local.name}-writer"
  engine                      = "mysql"
  engine_version              = var.db_engine_version
  instance_class              = var.db_instance_class
  db_name                     = "poker777"
  username                    = var.db_master_username
  manage_master_user_password = true

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp2"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  availability_zone      = var.availability_zones[0]
  multi_az               = var.db_writer_multi_az
  publicly_accessible    = false

  backup_retention_period    = var.db_backup_retention_days
  backup_window              = "06:00-06:30"
  maintenance_window         = "sun:07:00-sun:07:30"
  auto_minor_version_upgrade = true
  deletion_protection        = var.db_deletion_protection
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-writer-final"
  copy_tags_to_snapshot      = true

  enabled_cloudwatch_logs_exports = ["error", "general", "slowquery"]
  performance_insights_enabled    = false

  tags = { Name = "${local.name}-writer", Role = "writer" }
}

resource "aws_db_instance" "reader" {
  count = 3

  identifier                      = "${local.name}-reader-${count.index + 1}"
  replicate_source_db             = aws_db_instance.writer.arn
  instance_class                  = var.db_instance_class
  availability_zone               = local.read_replica_azs[count.index]
  publicly_accessible             = false
  auto_minor_version_upgrade      = true
  deletion_protection             = var.db_deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-reader-${count.index + 1}-final"
  copy_tags_to_snapshot           = true
  vpc_security_group_ids          = [aws_security_group.database.id]
  db_subnet_group_name            = aws_db_subnet_group.main.name
  enabled_cloudwatch_logs_exports = ["error", "general", "slowquery"]

  tags = { Name = "${local.name}-reader-${count.index + 1}", Role = "reader" }
}