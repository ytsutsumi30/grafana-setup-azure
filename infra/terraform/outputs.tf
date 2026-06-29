output "resource_group_name" { value = azurerm_resource_group.main.name }
output "location" { value = azurerm_resource_group.main.location }
output "acr_name" { value = azurerm_container_registry.main.name }
output "acr_login_server" { value = azurerm_container_registry.main.login_server }
output "api_container_app_name" { value = azurerm_container_app.api.name }
output "web_container_app_name" { value = azurerm_container_app.web.name }
output "api_internal_fqdn" { value = azurerm_container_app.api.ingress[0].fqdn }
output "web_url" { value = "https://${azurerm_container_app.web.ingress[0].fqdn}" }