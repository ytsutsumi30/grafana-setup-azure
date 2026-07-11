variable "environment_name" {
  description = "Base name for Azure resources."
  type        = string
  default     = "shipping-inspection-poc"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "japaneast"
}

variable "resource_group_name" {
  description = "Resource group name."
  type        = string
  default     = "rg-shipping-inspection-poc"
}

variable "supabase_db_host" {
  description = "Supabase PostgreSQL host. For IPv4-only networks, use the Supabase session pooler host."
  type        = string
  sensitive   = true
}

variable "supabase_db_port" {
  description = "Supabase PostgreSQL port."
  type        = string
  default     = "5432"
}

variable "supabase_db_name" {
  description = "Supabase database name."
  type        = string
  default     = "postgres"
}

variable "supabase_db_user" {
  description = "Supabase PostgreSQL user. Direct: postgres. Pooler: postgres.<project-ref>."
  type        = string
  sensitive   = true
}

variable "supabase_db_password" {
  description = "Supabase PostgreSQL password."
  type        = string
  sensitive   = true
}

variable "enable_aws_textract" {
  description = "Enable AWS Textract env vars for OCR. Deferred for initial POC."
  type        = bool
  default     = false
}

variable "aws_region" {
  description = "AWS region for Textract when enabled."
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_access_key_id" {
  description = "AWS access key for Textract when enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "aws_secret_access_key" {
  description = "AWS secret key for Textract when enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_gcp_document_ai" {
  description = "Enable GCP Document AI. Deferred for initial POC."
  type        = bool
  default     = false
}

variable "gcp_project_id" {
  description = "GCP project ID for Document AI when enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "documentai_processor_id" {
  description = "GCP Document AI processor ID when enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "m365_auth_enabled" {
  description = "Enable Microsoft 365 delegated authentication through MSAL and Microsoft Graph."
  type        = bool
  default     = false
}

variable "m365_auth_required" {
  description = "Require Microsoft 365 delegated authentication for application API calls."
  type        = bool
  default     = false
}

variable "m365_auth_tenant_id" {
  description = "Microsoft Entra tenant ID for delegated Microsoft 365 sign-in."
  type        = string
  default     = ""
  sensitive   = true
}

variable "m365_auth_client_id" {
  description = "Microsoft Entra application client ID for the browser MSAL app."
  type        = string
  default     = ""
  sensitive   = true
}

variable "m365_auth_scopes" {
  description = "Microsoft Graph delegated scopes requested by the browser client."
  type        = string
  default     = "User.Read"
}

variable "m365_auth_allowed_domains" {
  description = "Optional comma-separated list of email domains allowed to use the app."
  type        = string
  default     = ""
}

variable "write_auth_mode" {
  description = "Authentication mode for write APIs: off, warn, or enforce. Public Azure POC should use enforce."
  type        = string
  default     = "enforce"

  validation {
    condition     = contains(["off", "warn", "enforce"], lower(var.write_auth_mode))
    error_message = "write_auth_mode must be one of: off, warn, enforce."
  }
}

variable "admin_api_token" {
  description = "Optional admin token for protected maintenance APIs and write APIs when M365 auth is disabled. Sent by trusted clients as x-admin-token."
  type        = string
  default     = ""
  sensitive   = true
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default = {
    project     = "shipping-inspection"
    environment = "poc"
    managed_by  = "terraform"
  }
}
