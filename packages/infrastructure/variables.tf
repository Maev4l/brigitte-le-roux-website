variable "domain_name" {
  description = "Public domain name"
  type        = string
  default     = "brigitte-le-roux.com"
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone id (already exists; managed elsewhere)"
  type        = string
  default     = "Z10238282ED2UHGM8STZA"
}

variable "bucket_name" {
  description = "S3 bucket name for site content (must be globally unique)"
  type        = string
  default     = "brigitte-le-roux-website"
}

variable "aws_region" {
  description = "AWS region for the S3 bucket"
  type        = string
  default     = "eu-central-1"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default = {
    application = "brigitte-le-roux-website"
    owner       = "terraform"
  }
}
