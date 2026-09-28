variable "aws_region" {
  type        = string
  description = "AWS region containing the application and ACM certificate."
}

variable "project" {
  type    = string
  default = "poker777"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "availability_zones" {
  type        = list(string)
  description = "At least two AZ names in aws_region."
  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "At least two Availability Zones are required."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "One public subnet CIDR per availability zone."
  validation {
    condition     = length(var.public_subnet_cidrs) == length(var.availability_zones)
    error_message = "Provide one public subnet CIDR for every availability zone."
  }
}

variable "private_app_subnet_cidrs" {
  type        = list(string)
  description = "One private application subnet CIDR per availability zone."
  validation {
    condition     = length(var.private_app_subnet_cidrs) == length(var.availability_zones)
    error_message = "Provide one application subnet CIDR for every availability zone."
  }
}

variable "private_data_subnet_cidrs" {
  type        = list(string)
  description = "One isolated RDS/cache subnet CIDR per availability zone."
  validation {
    condition     = length(var.private_data_subnet_cidrs) == length(var.availability_zones)
    error_message = "Provide one data subnet CIDR for every availability zone."
  }
}

variable "site_domain" {
  type        = string
  description = "Public website FQDN, for example poker.example.com."
}

variable "route53_zone_id" {
  type        = string
  description = "Route 53 hosted zone ID for site_domain."
}

variable "acm_certificate_arn" {
  type        = string
  description = "Validated ACM certificate ARN in aws_region."
}

variable "backend_secret_arn" {
  type        = string
  description = "Secrets Manager JSON secret containing DB_USER, DB_PASSWORD, JWT_SECRET, INTERNAL_API_KEY, and optionally REDIS_PASSWORD."
}

variable "backend_image_tag" {
  type        = string
  description = "Immutable backend ECR image tag; publish this image before increasing ASG desired capacity."
}

variable "frontend_image_tag" {
  type        = string
  description = "Immutable frontend ECR image tag; publish this image before increasing ASG desired capacity."
}

variable "frontend_instance_type" {
  type    = string
  default = "t3.small"
}

variable "backend_instance_type" {
  type    = string
  default = "t3.small"
}

variable "frontend_min_size" {
  type    = number
  default = 0
}

variable "frontend_desired_capacity" {
  type    = number
  default = 0
}

variable "frontend_max_size" {
  type    = number
  default = 4
}

variable "backend_min_size" {
  type    = number
  default = 0
}

variable "backend_desired_capacity" {
  type    = number
  default = 0
}

variable "backend_max_size" {
  type    = number
  default = 4
}

variable "db_engine_version" {
  type        = string
  description = "RDS MySQL engine version available in the selected region/AZs."
}

variable "db_parameter_group_family" {
  type        = string
  description = "Matching RDS MySQL parameter group family, for example mysql8.0."
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_master_username" {
  type    = string
  default = "pokeradmin"
}

variable "db_allocated_storage" {
  type    = number
  default = 50
}

variable "db_max_allocated_storage" {
  type    = number
  default = 200
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "db_writer_multi_az" {
  type        = bool
  default     = false
  description = "Adds an RDS-managed standby in addition to the writer and three readable replicas."
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

variable "redis_engine_version" {
  type        = string
  description = "ElastiCache Redis OSS engine version supported in the selected region."
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "redis_auth_token" {
  type        = string
  sensitive   = true
  default     = null
  description = "Optional ElastiCache AUTH token. Terraform state will contain this value if set."
}

variable "redis_snapshot_retention_days" {
  type    = number
  default = 1
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "alert_email" {
  type        = string
  default     = null
  description = "Optional email address for CloudWatch alarm notifications; recipient must confirm the SNS subscription."
}