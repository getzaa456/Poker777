# Poker777 test stack for an AWS Academy Learner Lab — follows the team's "Poker777 Deployment Guide"
# step by step, but instead of baking AMIs by hand, every instance runs the repo's own
# backend/ec2-user-data.sh or frontend/frontend.sh at boot (so those scripts get tested too).
#
# State is kept locally (terraform.tfstate in this folder, git-ignored) and everything is removed
# with `terraform destroy`.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.aws_region
  # Learner Lab keys from lab.auto.tfvars (git-ignored). Left empty -> ~/.aws/credentials is used.
  access_key = var.aws_access_key == "" ? null : var.aws_access_key
  secret_key = var.aws_secret_key == "" ? null : var.aws_secret_key
  token      = var.aws_session_token == "" ? null : var.aws_session_token
  default_tags {
    tags = { Project = "poker777", Environment = "prod-test", ManagedBy = "terraform-test" }
  }
}

locals {
  name = "poker777-prod"
  azs  = ["${var.aws_region}a", "${var.aws_region}b"]
}

# Learner Lab cannot create IAM roles: use the ones the lab provides.
data "aws_iam_role" "lab" {
  name = "LabRole"
}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}
