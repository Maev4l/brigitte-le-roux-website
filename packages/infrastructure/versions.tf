terraform {

  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "global-tf-states"
    key          = "brigitte-le-roux-website/terraform.tfstate"
    region       = "eu-central-1"
    use_lockfile = true
  }
}
