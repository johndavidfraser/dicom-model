# ─── Terraform configuration ──────────────────────────────
#
# This file describes the AWS infrastructure for dicom-model.
# Everything eksctl created with one command is defined here
# as code: the VPC, subnets, EKS cluster, and node group.
#
# Why bother? Because:
#   1. It's version-controlled — changes are reviewed in PRs
#   2. It's reproducible — anyone can spin up an identical
#      cluster by running "terraform apply"
#   3. It's self-documenting — the .tf files ARE the docs
#   4. It's auditable — git history shows who changed what
#
# Terraform reads all .tf files in a directory and merges
# them. We split into separate files by concern:
#   main.tf      — provider config and core resources
#   variables.tf — input variables (knobs you can tweak)
#   outputs.tf   — values Terraform prints after apply

# The "terraform" block configures Terraform itself.
# "required_providers" tells Terraform which plugins to
# download — we need the AWS provider to manage AWS resources.
terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# The "provider" block configures the AWS plugin.
# It uses your AWS CLI credentials automatically —
# the same ones from "aws configure".
provider "aws" {
  region = var.aws_region
}

# ─── Data sources ─────────────────────────────────────────
# Data sources read information from AWS without creating
# anything. We use them to discover what availability zones
# are available in the region.
data "aws_availability_zones" "available" {
  state = "available"
}

# ─── VPC ──────────────────────────────────────────────────
# The Virtual Private Cloud is the network boundary for
# everything. All EKS nodes, load balancers, and internal
# traffic live inside this VPC.
#
# We use a community module instead of defining every subnet,
# route table, NAT gateway, and internet gateway individually.
# The module encapsulates ~20 AWS resources into a few lines
# of configuration. This is like using a library instead of
# writing everything from scratch.
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.16.0"

  name = "${var.project_name}-vpc"
  cidr = "10.0.0.0/16"

  # Spread across 2 availability zones for redundancy —
  # same pattern eksctl used
  azs             = slice(data.aws_availability_zones.available.names, 0, 2)
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  # NAT gateway lets private subnet resources (EKS nodes)
  # reach the internet (to pull images from GHCR) without
  # being directly accessible from the internet.
  enable_nat_gateway   = true
  single_nat_gateway   = true # One NAT to save cost
  enable_dns_hostnames = true

  # Tags required by EKS to discover which subnets to use
  # for internal traffic vs external load balancers.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }

  tags = var.common_tags
}

# ─── EKS Cluster ──────────────────────────────────────────
# The managed Kubernetes control plane. AWS runs the API
# server, etcd, and scheduler — you just use kubectl.
#
# Like the VPC, we use a community module that wraps the
# ~15 AWS resources needed for a working EKS cluster.
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.31.6"

  cluster_name    = var.project_name
  cluster_version = var.k8s_version

  # The VPC and subnets where the cluster lives
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Allow public access to the Kubernetes API so kubectl
  # works from your Mac and from GitHub Actions.
  cluster_endpoint_public_access = true

  # Managed node group — AWS handles OS updates, scaling,
  # and node replacement. Same as the --managed flag in eksctl.
  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_instance_type]
      min_size       = var.node_min_count
      max_size       = var.node_max_count
      desired_size   = var.node_desired_count

      # Labels help Kubernetes schedule pods to specific
      # node groups if you have multiple groups later
      labels = {
        role = "general"
      }
    }
  }

  # Grant the CLI user admin access to the cluster
  # Without this, the user who runs terraform apply
  # can ceate the cluster but can't use kubectl to 
  # manage it, the access entry must be explicit
  access_entries = {
    admin = {
      principal_arn = var.admin_principal_arn
      policy_associations = {
        admin = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  }

  tags = var.common_tags
}