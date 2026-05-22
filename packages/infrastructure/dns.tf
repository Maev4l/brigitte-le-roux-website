resource "aws_route53_record" "site" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

# Google Search Console domain-property verification.
# Once verified, this record can be deleted — but Google rechecks periodically,
# so it is safer to leave it in place.
resource "aws_route53_record" "google_site_verification" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 300
  records = ["google-site-verification=5q0Rk16zHDeHhP_0Igihm1cyi2IAU0wQMYkfkWmJ8nw"]
}

resource "aws_route53_record" "cms" {
  zone_id = var.hosted_zone_id
  name    = "cms.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cms.domain_name
    zone_id                = aws_cloudfront_distribution.cms.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "cms_aaaa" {
  zone_id = var.hosted_zone_id
  name    = "cms.${var.domain_name}"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.cms.domain_name
    zone_id                = aws_cloudfront_distribution.cms.hosted_zone_id
    evaluate_target_health = false
  }
}
