locals {
  normalized_environment = lower(replace(var.environment_name, "_", "-"))
  acr_name               = substr(replace("cr${random_string.suffix.result}${local.normalized_environment}", "-", ""), 0, 50)
  placeholder_image      = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"

  api_secrets = concat([
    {
      name  = "supabase-db-host"
      value = var.supabase_db_host
    },
    {
      name  = "supabase-db-user"
      value = var.supabase_db_user
    },
    {
      name  = "supabase-db-password"
      value = var.supabase_db_password
    }
    ], var.enable_aws_textract ? [
    {
      name  = "aws-access-key-id"
      value = var.aws_access_key_id
    },
    {
      name  = "aws-secret-access-key"
      value = var.aws_secret_access_key
    }
    ] : [], var.enable_gcp_document_ai ? [
    {
      name  = "gcp-project-id"
      value = var.gcp_project_id
    },
    {
      name  = "documentai-processor-id"
      value = var.documentai_processor_id
    }
  ] : [])
}

resource "random_string" "suffix" {
  length  = 8
  upper   = false
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${local.normalized_environment}-logs-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_application_insights" "main" {
  name                = "${local.normalized_environment}-appi-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = var.tags
}

resource "azurerm_container_registry" "main" {
  name                = local.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = var.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "${local.normalized_environment}-env-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = var.tags
}

resource "azurerm_container_app" "api" {
  name                         = "${local.normalized_environment}-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = merge(var.tags, { "azd-service-name" = "api" })

  identity {
    type = "SystemAssigned"
  }

  dynamic "secret" {
    for_each = local.api_secrets
    content {
      name  = secret.value.name
      value = secret.value.value
    }
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = "api"
      image  = local.placeholder_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3001"
      }
      env {
        name        = "DB_HOST"
        secret_name = "supabase-db-host"
      }
      env {
        name  = "DB_PORT"
        value = var.supabase_db_port
      }
      env {
        name  = "DB_NAME"
        value = var.supabase_db_name
      }
      env {
        name        = "DB_USER"
        secret_name = "supabase-db-user"
      }
      env {
        name        = "DB_PASSWORD"
        secret_name = "supabase-db-password"
      }
      env {
        name  = "DB_SSL"
        value = "true"
      }
      env {
        name  = "DB_SSL_REJECT_UNAUTHORIZED"
        value = "false"
      }
      env {
        name  = "AWS_REGION"
        value = var.aws_region
      }
      env {
        name  = "ENABLE_GCP_DOCUMENTAI"
        value = tostring(var.enable_gcp_document_ai)
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.main.connection_string
      }

      dynamic "env" {
        for_each = var.enable_aws_textract ? toset(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) : toset([])
        content {
          name        = env.value
          secret_name = env.value == "AWS_ACCESS_KEY_ID" ? "aws-access-key-id" : "aws-secret-access-key"
        }
      }

      dynamic "env" {
        for_each = var.enable_gcp_document_ai ? toset(["GCP_PROJECT_ID", "DOCUMENTAI_PROCESSOR_ID"]) : toset([])
        content {
          name        = env.value
          secret_name = env.value == "GCP_PROJECT_ID" ? "gcp-project-id" : "documentai-processor-id"
        }
      }
    }
  }

  ingress {
    external_enabled           = false
    target_port                = 3001
    transport                  = "http"
    allow_insecure_connections = true

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
      registry,
    ]
  }
}

resource "azurerm_container_app" "web" {
  name                         = "${local.normalized_environment}-web"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = merge(var.tags, { "azd-service-name" = "web" })

  identity {
    type = "SystemAssigned"
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = "web"
      image  = local.placeholder_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "API_UPSTREAM"
        value = "http://${azurerm_container_app.api.ingress[0].fqdn}"
      }
    }
  }

  ingress {
    external_enabled           = true
    target_port                = 80
    transport                  = "http"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
      registry,
    ]
  }
}

resource "azurerm_role_assignment" "api_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_container_app.api.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "web_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_container_app.web.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}