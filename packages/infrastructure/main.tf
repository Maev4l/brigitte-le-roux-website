provider "aws" {
  region = var.aws_region
  default_tags {
    tags = var.tags
  }
}

# CloudFront and ACM certificates for CloudFront MUST live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = var.tags
  }
}
