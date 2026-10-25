# Guide steps 2-6: VPC, 8 subnets over 2 AZs, Internet Gateway, 2 NAT Gateways, route tables.

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

locals {
  subnets = {
    "public-1"   = { cidr = "10.40.0.0/24", az = 0 }
    "public-2"   = { cidr = "10.40.1.0/24", az = 1 }
    "app-1"      = { cidr = "10.40.10.0/24", az = 0 }
    "app-2"      = { cidr = "10.40.11.0/24", az = 1 }
    "data-1"     = { cidr = "10.40.20.0/24", az = 0 }
    "data-2"     = { cidr = "10.40.21.0/24", az = 1 }
    "frontend-1" = { cidr = "10.40.100.0/24", az = 0 }
    "frontend-2" = { cidr = "10.40.101.0/24", az = 1 }
  }
}

resource "aws_subnet" "this" {
  for_each          = local.subnets
  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = local.azs[each.value.az]
  tags              = { Name = "${local.name}-${each.key}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-${count.index + 1}" }
}

resource "aws_nat_gateway" "nat" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.this["public-${count.index + 1}"].id
  tags          = { Name = "${local.name}-nat-${count.index + 1}" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  for_each       = toset(["public-1", "public-2"])
  subnet_id      = aws_subnet.this[each.key].id
  route_table_id = aws_route_table.public.id
}

# frontend-N and app-N go out through nat-N (same AZ).
resource "aws_route_table" "private" {
  for_each = toset(["frontend-1", "frontend-2", "app-1", "app-2"])
  vpc_id   = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat[tonumber(substr(each.key, -1, 1)) - 1].id
  }
  tags = { Name = "${local.name}-${each.key}" }
}

resource "aws_route_table_association" "private" {
  for_each       = aws_route_table.private
  subnet_id      = aws_subnet.this[each.key].id
  route_table_id = each.value.id
}

# data-N: no internet route at all.
resource "aws_route_table" "data" {
  for_each = toset(["data-1", "data-2"])
  vpc_id   = aws_vpc.main.id
  tags     = { Name = "${local.name}-${each.key}" }
}

resource "aws_route_table_association" "data" {
  for_each       = aws_route_table.data
  subnet_id      = aws_subnet.this[each.key].id
  route_table_id = each.value.id
}
