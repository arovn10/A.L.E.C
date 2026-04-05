# A.L.E.C. - New Features Documentation

## 🎯 Overview
A.L.E.C. (Adaptive Learning Executive Coordinator) now includes comprehensive authentication, document processing, integrations, and full GitHub API access for Stoa Group repository mastery.

---

## 🔐 Authentication System

### Account Management
- **User Registration**: `/api/auth/register` - Create new accounts with personalized settings
- **Login**: `/api/auth/login` - Secure authentication with JWT tokens
- **Profile**: `/api/auth/profile` - Get user profile and settings
- **Settings Update**: `/api/auth/settings` - Modify account preferences

### Token Types
1. **FULL_CAPABILITIES** (Default)
   - Neural training access
   - Smart home control
   - Document processing
   - GitHub API full access
   - Admin operations (if admin role)

2. **STOA_ACCESS**
   - Permanent database read/write
   - Knowledge base queries
   - Training data storage

### Admin Account
- Email: `arovner@stoagroup.com`
- Password: `Wed75382` (same as DB password for simplicity)
- Special permissions: Personalization, training dataset configuration

---

## 📄 Document Processing & Real Estate Analysis

### Upload Documents
```bash
POST /api/documents/upload
Headers: Authorization: Bearer <token>
Body: multipart/form-data with 'document' file field
Accepts: PDF, DOCX, TXT (up to 20MB)
```

### Analyze as Real Estate Analyst
```bash
POST /api/documents/analyze
Body: { "filename": "...", "docId": "..." }
Returns: Document type, key metrics, risk factors, recommendations
```

**Analysis Capabilities:**
- Property valuation reports
- Lease agreements
- Market analysis
- Financial statements
- Investment memorandums

**Extracted Metrics:**
- Property values and prices
- Rental income data
- Cap rates
- Net Operating Income (NOI)
- Risk factors assessment

---

## 🔗 External Integrations

### Supported Platforms
1. **Microsoft Outlook/Exchange Online**
2. **Google Gmail**
3. **Microsoft Teams**
4. **Apple iMessage** (macOS only)
5. **Asana**

### Account Personalization
Each account type can be personalized separately:
- Language preferences
- Tone settings (professional, casual, etc.)
- Notification settings
- Data access levels
- Sync frequency

#### Connect External Account
```bash
POST /api/integrations/connect
Body: { "integrationId": "outlook", "credentials": {...} }
```

#### Sync Account Data
```bash
POST /api/integrations/sync
Body: { "integrationId": "gmail" }
```

#### Personalize Settings
```bash
GET  /api/integrations/:integrationId/personalization
PUT  /api/integrations/:integrationId/personalization
```

---

## 🌐 GitHub API Integration - Stoa Group Repository Mastery

### Full Repository Access
A.L.E.C. has **full capacity and authority** to:
- View, edit, understand everything in https://github.com/Stoa-Group
- Master Domo dashboards data
- Understand and use the API
- Read loan documents
- Update deals with up-to-date loan information

### Access Endpoints

#### Get Repository Information
```bash
GET /api/github/repo?owner=Stoa-Group&repo=reponame
Headers: Authorization: Bearer <FULL_CAPABILITIES_TOKEN>
```

#### Update Deal with Loan Info
```bash
POST /api/github/update-deal
Body: { "dealId": "DEAL001", "loanInfo": {...}, "updateType": "loan_update" }
Returns: Success confirmation and update details
```

### Capabilities
- Read all repository files and code
- Access Domo dashboard data through API
- Parse loan documents automatically
- Update deals with real-time information
- Understand API structure and usage patterns
- Master Stoa Group operations

---

## 🧠 STOA Database - Permanent Training Data Source

### Purpose
- **Master of all things Stoa Group**
- Constantly updates with new training data
- Stores learning experiences permanently
- Maintains knowledge base for real estate expertise

### Connection Configuration (Azure SQL)
```env
STOA_DB_HOST=stoagroupdb.database.windows.net
STOA_DB_PORT=1433
STOA_DB_NAME=stoagroupDB
STOA_DB_USER=arovner
STOA_DB_PASSWORD=Wed75382
STOA_DB_SSL=true
```

### Database Tables
- `altec_training_data`: User queries and responses for learning
- `stoa_group_knowledge`: Master knowledge base about Stoa Group
- `model_updates`: Version tracking for model improvements
- `document_analysis`: Processed document analysis results

### Endpoints

#### Connect to STOA Database
```bash
POST /api/data-sources/connect
Headers: Authorization: Bearer <token>
Returns: Connection status and database statistics
```

#### Get Knowledge Base (Master of Stoa Group)
```bash
GET  /api/data-sources/knowledge/:topic?
Query Parameters: topic (optional), limit=10
Returns: Relevant knowledge entries with confidence scores
```

#### Update Knowledge Base
```bash
POST /api/data-sources/knowledge
Body: { "topic": "...", "content": "...", "source": "...", "confidence": 1.0 }
```

---

## 🎤 Voice Interface

### WebSocket Connection
- **Port**: 3002
- **Protocol**: wss://localhost:3002 (encrypted in production)

#### Start Recording
```javascript
ws.send(JSON.stringify({ type: 'start_recording' }));
```

#### Send Audio Data
```javascript
ws.send(JSON.stringify({ 
  type: 'audio_data', 
  data: base64EncodedAudio,
  timestamp: Date.now()
}));
```

#### TTS Request
```javascript
ws.send(JSON.stringify({ 
  type: 'tts_request', 
  text: "Hello A.L.E.C." 
}));
```

---

## 👤 Admin Features (arovner@stoagroup.com)

### Personalize Any Account
```bash
POST /api/admin/personalize
Body: { "userId": "...", "settings": {...} }
```

### Configure Training Dataset
```bash
POST /api/admin/set-training-dataset
Body: { 
  "datasetName": "stoa_group_mastery",
  "languageSettings": {"primary": "en-US"},
  "toneSettings": {"default": "professional"}
}
```

---

## 📊 Example Usage Flow

### 1. Register New User
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword",
    "settings": {
      "language": "en-US",
      "tone": "professional"
    }
  }'
```

### 2. Login and Get Token
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword"
  }'
```

### 3. Upload Document for Real Estate Analysis
```bash
curl -X POST http://localhost:3001/api/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "document=@/path/to/property_report.pdf"
```

### 4. Analyze as Real Estate Analyst
```bash
curl -X POST http://localhost:3001/api/documents/analyze \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "user_20260330_property_report.pdf",
    "docId": "DOC001"
  }'
```

### 5. Connect Outlook Account
```bash
curl -X POST http://localhost:3001/api/integrations/connect \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "integrationId": "outlook",
    "credentials": {
      "clientId": "...",
      "clientSecret": "...",
      "tenantId": "..."
    }
  }'
```

### 6. Sync Outlook Data
```bash
curl -X POST http://localhost:3001/api/integrations/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "integrationId": "outlook"
  }'
```

### 7. Access Stoa Group Repository
```bash
curl -X GET http://localhost:3001/api/github/repo?owner=Stoa-Group&repo=reponame \
  -H "Authorization: Bearer <FULL_CAPABILITIES_TOKEN>"
```

### 8. Update Deal with Loan Information
```bash
curl -X POST http://localhost:3001/api/github/update-deal \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "dealId": "DEAL001",
    "loanInfo": {
      "principalAmount": 5000000,
      "interestRate": 4.25,
      "maturityDate": "2030-12-31",
      "lastUpdated": "2026-03-30"
    },
    "updateType": "loan_update"
  }'
```

---

## 🔒 Security Features

### Authentication
- JWT tokens with 7-day expiry
- Bearer token authentication for all protected endpoints
- Role-based access control (Admin, User)
- Password hashing with bcryptjs

### Data Protection
- SSL/TLS required for Azure SQL connection
- Encrypted credential storage (in production)
- File upload size limits (20MB max)
- Input validation and sanitization
- CORS protection enabled

---

## 🚀 Getting Started

1. **Install Dependencies**: `npm install`
2. **Configure Environment**: Update `.env` with your credentials
3. **Initialize System**: `node backend/server.js`
4. **Connect to Voice Interface**: WebSocket on port 3002
5. **Start Learning**: Upload documents, connect accounts, query knowledge base

---

## 📝 Notes

- **Stoa Group Mastery**: A.L.E.C. is designed to become the master of all things Stoa Group through constant learning and database updates
- **Real Estate Expertise**: Document analysis powered by real estate analyst capabilities
- **Account Personalization**: Each external account (Outlook, Gmail, Teams, etc.) has individual settings
- **Continuous Learning**: All interactions are saved to STOA database for permanent model improvement

---

## 🤝 Support

For questions or issues:
- Email: arovner@stoagroup.com
- Check logs in `backend/server.js` console output
- Review API endpoints documentation above
