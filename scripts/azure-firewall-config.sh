#!/bin/bash

# A.L.E.C. - Azure Firewall Configuration Script
# Automatically add current IP address to Azure SQL firewall rules
# Owned by arovner@campusrentalsllc.com

echo "🔐 A.L.E.C. Azure Firewall Configuration"
echo "========================================"

# Get your public IP address
YOUR_IP=$(curl -s https://api.ipify.org)
echo "Your current IP: $YOUR_IP"

# Set variables (update these with your Azure credentials)
RESOURCE_GROUP="STOA-Group"
SERVER_NAME="stoagroupdb"
FIREWALL_RULE_NAME="ALEC-AutoAllow-$(date +%Y%m%d-%H%M%S)"

echo "Resource Group: $RESOURCE_GROUP"
echo "Server Name: $SERVER_NAME"
echo "Firewall Rule Name: $FIREWALL_RULE_NAME"

# Check if Azure CLI is logged in
if ! az account show &> /dev/null; then
    echo "❌ Not logged into Azure. Please run 'az login' first."
    exit 1
fi

# Create firewall rule
echo "🔨 Creating firewall rule..."
az sql server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SERVER_NAME" \
  --name "$FIREWALL_RULE_NAME" \
  --start-ip-address "$YOUR_IP" \
  --end-ip-address "$YOUR_IP"

if [ $? -eq 0 ]; then
    echo "✅ Firewall rule created successfully!"
    echo "   Rule Name: $FIREWALL_RULE_NAME"
    echo "   IP Address: $YOUR_IP"
    echo "   Server: $SERVER_NAME"
    echo ""
    echo "📝 You can verify the rule in Azure Portal:"
    echo "   https://portal.azure.com/#@stoagroup.onmicrosoft.com/resource/subscriptions/your-subscription-id/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Sql/servers/$SERVER_NAME/firewallRules/view"
else
    echo "❌ Failed to create firewall rule. Please check your Azure credentials."
    exit 1
fi
