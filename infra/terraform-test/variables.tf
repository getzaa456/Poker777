variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# Learner Lab "AWS Details" keys. Put them in lab.auto.tfvars (never committed); they expire with the session.
variable "aws_access_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "aws_secret_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "aws_session_token" {
  type      = string
  default   = ""
  sensitive = true
}

variable "git_branch" {
  description = "Branch of github.com/getzaa456/Poker777 that every instance clones when it boots"
  type        = string
  default     = "AlmostDone"
}

variable "code_revision" {
  description = "Any label for the pushed code (e.g. the commit). Changing it makes new launch template versions, so tools/loadtest/asg-replace.mjs swaps the instances and they clone the branch again"
  type        = string
  default     = "initial"
}

variable "instance_type" {
  description = "Frontend and backend EC2 size (guide: t3.micro)"
  type        = string
  default     = "t3.micro"
}

variable "frontend_min" {
  description = "Frontend Auto Scaling Group minimum (= starting size). Guide: 2 = one per AZ"
  type        = number
  default     = 2
}

variable "frontend_max" {
  description = "Frontend Auto Scaling Group maximum"
  type        = number
  default     = 4
}

variable "backend_min" {
  description = "Backend Auto Scaling Group minimum (= starting size). 2 = one per AZ"
  type        = number
  default     = 2
}

variable "backend_max" {
  description = "Backend Auto Scaling Group maximum"
  type        = number
  default     = 4
}

variable "backend_cpu_target" {
  description = "Scaling rule: keep average backend CPU at this %. Node.js uses one core of two, so ~50 % is a full core — keep it well below"
  type        = number
  default     = 30
}

variable "backend_scaling_warmup" {
  description = "Seconds a new backend instance is ignored by the scaling rule while it boots"
  type        = number
  default     = 180
}

variable "db_instance_class" {
  description = "Guide: db.t4g.micro"
  type        = string
  default     = "db.t4g.micro"
}

variable "read_replica_count" {
  description = "Guide: 3 (read-1 in us-east-1a, read-2/3 in us-east-1b)"
  type        = number
  default     = 3
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.micro"
}

variable "acm_certificate_arn" {
  description = "Optional. With a certificate the public ALB serves HTTPS on 443 and redirects 80 -> 443 (guide step 13). Empty = plain HTTP on the ALB DNS name."
  type        = string
  default     = ""
}

variable "site_domain" {
  description = "Optional domain that points at the public ALB (added to CORS_ALLOWED_ORIGINS), e.g. poker777.club"
  type        = string
  default     = ""
}
