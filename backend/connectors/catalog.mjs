// backend/connectors/catalog.mjs — seed source for connector_definitions.
// Fields use: type in {text, password, url, textarea, select}; secret=true marks
// values the vault must encrypt and the API must redact in non-reveal reads.

export const CATALOG = [
  { id: 'github', name: 'GitHub', category: 'source-control', icon: 'github', auth_type: 'apikey', multi_instance: 0, is_org_only: 0,
    fields: [{ key: 'GITHUB_TOKEN', label: 'Personal Access Token', type: 'password', required: true, secret: true }] },

  { id: 'microsoft365', name: 'Microsoft 365', category: 'productivity', icon: 'microsoft', auth_type: 'oauth', multi_instance: 1, is_org_only: 0,
    fields: [
      { key: 'MS365_TENANT_ID',     label: 'Tenant ID',     type: 'text',     required: true,  secret: false },
      { key: 'MS365_CLIENT_ID',     label: 'Client ID',     type: 'text',     required: true,  secret: false },
      { key: 'MS365_CLIENT_SECRET', label: 'Client Secret', type: 'password', required: true,  secret: true },
      { key: 'MS365_REFRESH_TOKEN', label: 'Refresh Token', type: 'password', required: false, secret: true },
    ] },

  { id: 'tenantcloud', name: 'TenantCloud', category: 'finance', icon: 'home', auth_type: 'apikey', multi_instance: 0, is_org_only: 1,
    fields: [
      { key: 'TENANTCLOUD_EMAIL',    label: 'Email',    type: 'text',     required: true, secret: false },
      { key: 'TENANTCLOUD_PASSWORD', label: 'Password', type: 'password', required: true, secret: true  },
    ] },

  { id: 'twilio', name: 'Twilio', category: 'comms', icon: 'phone', auth_type: 'apikey', multi_instance: 0, is_org_only: 0,
    fields: [
      { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', type: 'text',     required: true,  secret: false },
      { key: 'TWILIO_AUTH_TOKEN',  label: 'Auth Token',  type: 'password', required: true,  secret: true  },
      { key: 'TWILIO_FROM',        label: 'From Number', type: 'text',     required: false, secret: false },
    ] },

  { id: 'stoa', name: 'Stoa Group DB', category: 'data', icon: 'database', auth_type: 'custom', multi_instance: 0, is_org_only: 1,
    fields: [
      { key: 'STOA_DB_HOST',     label: 'Host',     type: 'text',     required: true, secret: false },
      { key: 'STOA_DB_USER',     label: 'User',     type: 'text',     required: true, secret: false },
      { key: 'STOA_DB_PASSWORD', label: 'Password', type: 'password', required: true, secret: true  },
      { key: 'STOA_DB_NAME',     label: 'Database', type: 'text',     required: true, secret: false },
    ] },

  { id: 'homeassistant', name: 'Home Assistant', category: 'smart-home', icon: 'home', auth_type: 'apikey', multi_instance: 0, is_org_only: 1,
    fields: [
      { key: 'HOMEASSISTANT_URL',   label: 'Base URL',          type: 'url',      required: true, secret: false },
      { key: 'HOMEASSISTANT_TOKEN', label: 'Long-Lived Token',  type: 'password', required: true, secret: true  },
    ] },

  { id: 'imessage', name: 'iMessage', category: 'comms', icon: 'message', auth_type: 'custom', multi_instance: 0, is_org_only: 0,
    fields: [{ key: 'IMESSAGE_DB_PATH', label: 'chat.db path', type: 'text', required: true, secret: false }] },

  { id: 'aws', name: 'AWS', category: 'data', icon: 'cloud', auth_type: 'apikey', multi_instance: 1, is_org_only: 0,
    fields: [
      { key: 'AWS_ACCESS_KEY_ID',     label: 'Access Key ID',     type: 'text',     required: true, secret: false },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', type: 'password', required: true, secret: true  },
      { key: 'AWS_REGION',            label: 'Region',            type: 'text',     required: true, secret: false },
    ] },

  { id: 'render', name: 'Render', category: 'source-control', icon: 'rocket', auth_type: 'apikey', multi_instance: 0, is_org_only: 0,
    fields: [{ key: 'RENDER_API_KEY', label: 'API Key', type: 'password', required: true, secret: true }] },
];
