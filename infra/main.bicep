targetScope = 'resourceGroup'

@description('Environment name used for Azure resource names.')
param environmentName string = 'shipping-inspection-poc'

@description('Azure region for Container Apps resources.')
param location string = 'japaneast'

@description('Supabase PostgreSQL host, for example db.<project-ref>.supabase.co.')
@secure()
param supabaseDbHost string

@description('Supabase PostgreSQL port.')
param supabaseDbPort string = '5432'

@description('Supabase PostgreSQL database name. Default Supabase database is postgres.')
param supabaseDbName string = 'postgres'

@description('Supabase PostgreSQL user. Usually postgres or a project-specific pooler user.')
@secure()
param supabaseDbUser string

@description('Supabase PostgreSQL password.')
@secure()
param supabaseDbPassword string

@description('Enable AWS Textract OCR integration. Credentials are added as secrets only when enabled.')
param enableAwsTextract bool = false

@description('AWS region for Textract when enabled.')
param awsRegion string = 'ap-northeast-1'

@secure()
param awsAccessKeyId string = ''

@secure()
param awsSecretAccessKey string = ''

@description('GCP Document AI is deferred for this POC. Set true later when credentials are ready.')
param enableGcpDocumentAi bool = false

@secure()
param gcpProjectId string = ''

@secure()
param documentAiProcessorId string = ''

var suffix = uniqueString(resourceGroup().id, environmentName)
var prefix = toLower(environmentName)
var acrName = replace(take('cr${suffix}${replace(prefix, '-', '')}', 50), '-', '')
var logAnalyticsName = '${prefix}-logs-${suffix}'
var appInsightsName = '${prefix}-appi-${suffix}'
var acaEnvName = '${prefix}-env-${suffix}'
var apiAppName = '${prefix}-api'
var webAppName = '${prefix}-web'
var placeholderImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: acaEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

var apiSecrets = union([
  {
    name: 'supabase-db-host'
    value: supabaseDbHost
  }
  {
    name: 'supabase-db-name'
    value: supabaseDbName
  }
  {
    name: 'supabase-db-user'
    value: supabaseDbUser
  }
  {
    name: 'supabase-db-password'
    value: supabaseDbPassword
  }
], enableAwsTextract ? [
  {
    name: 'aws-access-key-id'
    value: awsAccessKeyId
  }
  {
    name: 'aws-secret-access-key'
    value: awsSecretAccessKey
  }
] : [], enableGcpDocumentAi ? [
  {
    name: 'gcp-project-id'
    value: gcpProjectId
  }
  {
    name: 'documentai-processor-id'
    value: documentAiProcessorId
  }
] : [])

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 3001
        transport: 'http'
        allowInsecure: true
      }
      secrets: apiSecrets
    }
    template: {
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
      containers: [
        {
          name: 'api'
          image: placeholderImage
          env: concat([
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3001'
            }
            {
              name: 'DB_HOST'
              secretRef: 'supabase-db-host'
            }
            {
              name: 'DB_PORT'
              value: supabaseDbPort
            }
            {
              name: 'DB_NAME'
              secretRef: 'supabase-db-name'
            }
            {
              name: 'DB_USER'
              secretRef: 'supabase-db-user'
            }
            {
              name: 'DB_PASSWORD'
              secretRef: 'supabase-db-password'
            }
            {
              name: 'DB_SSL'
              value: 'true'
            }
            {
              name: 'DB_SSL_REJECT_UNAUTHORIZED'
              value: 'false'
            }
            {
              name: 'AWS_REGION'
              value: awsRegion
            }
            {
              name: 'ENABLE_GCP_DOCUMENTAI'
              value: string(enableGcpDocumentAi)
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
          ], enableAwsTextract ? [
            {
              name: 'AWS_ACCESS_KEY_ID'
              secretRef: 'aws-access-key-id'
            }
            {
              name: 'AWS_SECRET_ACCESS_KEY'
              secretRef: 'aws-secret-access-key'
            }
          ] : [], enableGcpDocumentAi ? [
            {
              name: 'GCP_PROJECT_ID'
              secretRef: 'gcp-project-id'
            }
            {
              name: 'DOCUMENTAI_PROCESSOR_ID'
              secretRef: 'documentai-processor-id'
            }
          ] : [])
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
        allowInsecure: false
      }
    }
    template: {
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
      containers: [
        {
          name: 'web'
          image: placeholderImage
          env: [
            {
              name: 'API_UPSTREAM'
              value: 'http://${api.properties.configuration.ingress.fqdn}'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}

resource apiAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, api.name, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, web.name, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.properties.loginServer
output API_CONTAINER_APP_NAME string = api.name
output WEB_CONTAINER_APP_NAME string = web.name
output WEB_URI string = 'https://${web.properties.configuration.ingress.fqdn}'
output API_INTERNAL_FQDN string = api.properties.configuration.ingress.fqdn
