# ---- Input variables ---------------------
# Variables are the knobs on our infrastructure. Instead
# of hardcoding values, you parameterize them so the same
# Terraform code can create a dev cluster, a staging cluster
# or a production cluster with different sizes
#
# Each variable has a type, description, and default value
# You can override defaults at apply time with: 
# terraform apply -var="node_desired_count=3"

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name used for the EKS cluster, VPC, and resource tags"
  type        = string
  default     = "dicom-model-cloud"
}

variable "k8s_version" {
  description = "Kubernetes verson for the EKS cluster"
  type        = string
  default     = "1.31"
}

variable "node_instance_type" {
  description = "EC2 instance type for worker nodes"
  type        = string
  default     = "t3.small"
}

variable "node_min_count" {
  description = "Minimum number of worker nodes (autoscaling floor)"
  type        = number
  default     = 1
}

variable "node_max_count" {
  description = "Maximum number of worker nodes (autoscaling ceiling)"
  type        = number
  default     = 3
}

variable "node_desired_count" {
  description = "Starting number of worker nodes"
  type        = number
  default     = 2
}

variable "admin_principal_arn" {
  description = "IAM principal ARN granted EKS cluster admin access (e.g. arn:aws:iam::123456789012:user/cli-user)"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to all resources for cost tracking and organization"
  type        = map(string)
  default = {
    Project     = "dicom-model"
    ManagedBy   = "terraform"
    Environment = "learning"
  }
}