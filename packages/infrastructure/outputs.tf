output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_cms_distribution_id" {
  value       = aws_cloudfront_distribution.cms.id
  description = "CMS distribution. Must be invalidated alongside the site distribution on any public/cms/** change — it serves those objects from the same bucket under CachingOptimized (24h TTL)."
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  value = "https://${var.domain_name}/"
}

output "cms_url" {
  value       = "https://cms.${var.domain_name}/"
  description = "CMS entry point. Redirects to /cms/ where Sveltia is served."
}

output "cms_distribution_id" {
  value       = aws_cloudfront_distribution.cms.id
  description = "CMS CloudFront distribution ID (for cache invalidations)."
}

output "cms_distribution_domain" {
  value       = aws_cloudfront_distribution.cms.domain_name
  description = "CMS CloudFront distribution cloudfront.net domain (for debugging via raw URL)."
}

output "cloudfront_logs_bucket_name" {
  value       = aws_s3_bucket.cloudfront_logs.id
  description = "S3 bucket holding CloudFront access logs (Parquet under raw/site/, raw/cms/)."
}
