# Guide step 7: security groups. Rules are separate resources so groups can reference each other.

locals {
  security_groups = {
    "public-alb"   = "Public ALB: HTTP/HTTPS from the internet"
    "frontend"     = "Frontend nginx :3000 from the public ALB"
    "internal-alb" = "Internal ALB :4000 from the frontend"
    "backend"      = "Backend :4000 from the internal ALB"
    "cache"        = "Redis :6379 from the backend"
    "database"     = "MySQL :3306 from the backend and the RDS proxy"
    "proxy"        = "RDS proxy :3306 from the backend"
  }

  ingress = {
    alb_http     = { sg = "public-alb", port = 80, cidr = "0.0.0.0/0", from = null }
    alb_https    = { sg = "public-alb", port = 443, cidr = "0.0.0.0/0", from = null }
    frontend     = { sg = "frontend", port = 3000, cidr = null, from = "public-alb" }
    internal_alb = { sg = "internal-alb", port = 4000, cidr = null, from = "frontend" }
    backend      = { sg = "backend", port = 4000, cidr = null, from = "internal-alb" }
    cache        = { sg = "cache", port = 6379, cidr = null, from = "backend" }
    database     = { sg = "database", port = 3306, cidr = null, from = "backend" }
    # Not in the guide's table: without it the proxy cannot reach the database it fronts.
    database_prox = { sg = "database", port = 3306, cidr = null, from = "proxy" }
    proxy         = { sg = "proxy", port = 3306, cidr = null, from = "backend" }
  }

  # Guide: these keep AWS's default "all outbound"; cache/database have none.
  open_egress = ["public-alb", "frontend", "internal-alb", "backend"]
}

resource "aws_security_group" "this" {
  for_each    = local.security_groups
  name        = "${local.name}-${each.key}"
  description = each.value
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-${each.key}" }
}

resource "aws_vpc_security_group_ingress_rule" "this" {
  for_each                     = local.ingress
  security_group_id            = aws_security_group.this[each.value.sg].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  cidr_ipv4                    = each.value.cidr
  referenced_security_group_id = each.value.from == null ? null : aws_security_group.this[each.value.from].id
  description                  = each.key
}

resource "aws_vpc_security_group_egress_rule" "open" {
  for_each          = toset(local.open_egress)
  security_group_id = aws_security_group.this[each.key].id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# Guide 7.7: the proxy may only talk to the database.
resource "aws_vpc_security_group_egress_rule" "proxy_to_db" {
  security_group_id            = aws_security_group.this["proxy"].id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
  referenced_security_group_id = aws_security_group.this["database"].id
}
