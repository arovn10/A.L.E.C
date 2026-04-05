# A.L.E.C. - Cloud Deployment Guide

## 🚀 Quick Deploy to Vercel & Render

This guide provides step-by-step instructions for deploying A.L.E.C. to cloud platforms while maintaining full functionality and replicability across environments.

---

## Prerequisites

- ✅ GitHub account with repository
- ✅ Vercel account (free tier works)
- ✅ Render account (free tier works)
- ✅ Home Assistant instance (optional, for smart home features)
- ✅ Node.js 20+ installed locally for setup

---

## Part 1: Repository Setup (GitHub)

### Step 1.1: Prepare Your Repository

```bash
# Navigate to your A.L.E.C. directory
cd /path/to/A.L.E.C

# Initialize git if not already done
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial A.L.E.C. cloud-ready deployment"

# Create remote on GitHub (do this via web interface)
# Then link your local repo:
git remote add origin https://github.com/YOUR_USERNAME/a-lec.git

# Push to GitHub
git push -u origin main
```

### Step 1.2: Update .env.example for Cloud Deployment

Create a comprehensive `.env.example` file:

```bash
cat > .env.example << 'EOF'
# ========================================
# A.L.E.C. Cloud Deployment Configuration
# ========================================

# Local Database (for development/testing)
ALEC_LOCAL_DB_PATH=./data/local-alec.db

# Data Storage Strategy: local, vercel, hybrid
STORAGE_MODE=hybrid  # Recommended for production

# Vercel KV Storage API URL
VERCEL_STORAGE_URL=https://a-l-e-c-backend.vercel.app/api/storage

# Render API Access (for remote data fetching)
RENDER_API_KEY=your_render_api_token_here
BASE_RENDER_URL=https://dashboard.render.com/web/srv-d5jag6idbo4c73em4f20

# Home Assistant Integration (optional)
HOME_ASSISTANT_URL=http://localhost:8123
HOME_ASSISTANT_ACCESS_TOKEN=your_long_lived_token_here

# STOA Knowledge Base (Azure SQL - optional)
AZURE_SQL_SERVER=stoagroupdb.database.windows.net
AZURE_SQL_DATABASE=stoagroupDB
AZURE_SQL_USERNAME=your_username
AZURE_SQL_PASSWORD=your_password

# Fallback Settings
STORAGE_FALLBACK=local  # Use local storage if cloud unavailable

# Server Configuration
PORT=3001
VOICE_PORT=3002

# Security (generate your own)
JWT_SECRET=generate_a_random_secret_here
EOF
```

---

## Part 2: Deploy to Vercel (Backend & Storage API)

### Step 2.1: Configure Vercel Project

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy your project**:
   ```bash
   cd /path/to/A.L.E.C
   vercel --prod
   ```

4. **Set environment variables in Vercel dashboard**:
   - Go to your Vercel project settings
   - Navigate to "Environment Variables"
   - Add all variables from `.env.example` (except `HOME_ASSISTANT_*`)

### Step 2.2: Create Serverless API for Storage

Create `api/storage.js` in your Vercel project root:

```javascript
// api/storage.js
import { storage } from '@vercel/kv';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'POST': // Store data
      const { key, value, timestamp } = JSON.parse(req.body);
      
      if (!key || !value) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      try {
        await storage.set(key, value, { ttl: 60 * 60 * 24 * 30 }); // 30 days TTL
        res.status(200).json({ success: true, key, timestamp });
      } catch (error) {
        res.status(500).json({ error: 'Storage write failed' });
      }
      break;

    case 'GET': // Retrieve data or list keys
      if (req.query.key) {
        try {
          const value = await storage.get(req.query.key);
          
          if (!value) {
            return res.status(404).json({ error: 'Key not found' });
          }

          res.status(200).json({ key: req.query.key, value });
        } catch (error) {
          res.status(500).json({ error: 'Storage read failed' });
        }
      } else if (req.query.action === 'keys') {
        try {
          const keys = await storage.keys('*');
          res.status(200).json({ keys });
        } catch (error) {
          res.status(500).json({ error: 'Key listing failed' });
        }
      } else {
        res.status(400).json({ error: 'Specify key or action=keys' });
      }
      break;

    case 'DELETE': // Delete data
      const { key } = JSON.parse(req.body);
      
      if (!key) {
        return res.status(400).json({ error: 'Missing key' });
      }

      try {
        await storage.del(key);
        res.status(200).json({ success: true, deletedKey: key });
      } catch (error) {
        res.status(500).json({ error: 'Storage delete failed' });
      }
      break;

    default:
      res.setHeader('Allow', ['POST', 'GET', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}
```

### Step 2.3: Deploy Storage API

```bash
cd /path/to/A.L.E.C
vercel --prod
```

**Note**: You'll need to enable Vercel KV in your project settings for this to work.

---

## Part 3: Deploy to Render (Remote Data Fetcher)

### Step 3.1: Prepare Render Configuration

Create `render.yaml` in your repository root:

```yaml
services:
  - type: web
    name: a-lec-remote-data
    env: node
    plan: free
    branch: main
    
    buildCommand: npm install
    startCommand: node services/RemoteDataFetcher.js
    
    envVars:
      - key: RENDER_API_KEY
        sync: false
      - key: BASE_RENDER_URL
        value: https://dashboard.render.com/web/srv-d5jag6idbo4c73em4f20
        
    healthCheckPath: /health
    
    regions:
      - oregon  # Select closest to your users

envVarGroups:
  - name: production-env
    envVars:
      - key: NODE_ENV
        value: production
```

### Step 3.2: Create Health Check Endpoint

Create `services/healthCheck.js`:

```javascript
// services/healthCheck.js
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  const uptime = Math.floor(process.uptime());
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: uptime,
    memoryUsage: process.memoryUsage(),
    platform: process.platform
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🏥 Health check server running on port ${PORT}`);
});
```

### Step 3.3: Deploy to Render

1. Create a new Web Service in Render dashboard
2. Connect your GitHub repository
3. Select the `render.yaml` configuration
4. Add environment variables manually (RENDER_API_KEY)
5. Click "Create Web Service"

---

## Part 4: Configuration for Local Testing After Cloud Setup

### Step 4.1: Update .env.local

```bash
cat > .env.local << 'EOF'
# A.L.E.C. Local Development Configuration (Cloud-Ready)

# Storage Mode: Use hybrid mode for testing both local and cloud
STORAGE_MODE=hybrid

# Vercel Storage API (from your deployed project)
VERCEL_STORAGE_URL=https://your-vercel-project.vercel.app/api/storage

# Render API Key (from your Render deployment)
RENDER_API_KEY=your_render_api_key_here

# Local database path
ALEC_LOCAL_DB_PATH=./data/local-alec.db

# Home Assistant (optional, for smart home features)
HOME_ASSISTANT_URL=http://localhost:8123
HOME_ASSISTANT_ACCESS_TOKEN=your_ha_token_here

# Fallback to local if cloud unavailable
STORAGE_FALLBACK=local

# Server ports
PORT=3001
VOICE_PORT=3002
EOF
```

### Step 4.2: Run Integration Tests

```bash
chmod +x tests/integration_test.sh
./tests/integration_test.sh
```

Expected output: All critical tests should pass with some skipped items if cloud services aren't configured yet.

---

## Part 5: Production Optimization Checklist

Before deploying to production, ensure the following:

### ✅ Security Hardening

- [ ] Set strong `JWT_SECRET` (use `openssl rand -hex 32`)
- [ ] Enable HTTPS in Vercel/Render settings
- [ ] Configure CORS policies for frontend access
- [ ] Set up rate limiting on API endpoints
- [ ] Rotate API keys regularly

### ✅ Performance Tuning

- [ ] Enable Redis caching for frequently accessed data
- [ ] Compress responses with gzip/brotli
- [ ] Set appropriate cache headers for static assets
- [ ] Monitor memory usage and set limits

### ✅ Monitoring & Logging

- [ ] Set up error tracking (Sentry, LogRocket)
- [ ] Configure log aggregation (Datadog, Papertrail)
- [ ] Create uptime monitoring (UptimeRobot, Pingdom)
- [ ] Set up alerts for critical failures

### ✅ Backup Strategy

- [ ] Schedule daily database backups
- [ ] Store backups in separate cloud storage (AWS S3, Google Cloud Storage)
- [ ] Test restore procedures quarterly
- [ ] Document disaster recovery steps

---

## Part 6: Troubleshooting Common Issues

### Issue: Vercel Storage Returns 404 on First Deploy

**Solution**: 
1. Enable Vercel KV in project settings
2. Wait 5 minutes for service provisioning
3. Redeploy the API routes

### Issue: Render Service Won't Start

**Solution**:
1. Check logs in Render dashboard
2. Verify all environment variables are set
3. Ensure `startCommand` points to valid file
4. Check Node.js version compatibility

### Issue: Home Assistant Connection Fails

**Solution**:
1. Verify token is valid long-lived access token
2. Check firewall rules allow connections from your IP
3. Ensure WebSocket API is enabled in HA settings
4. Test connection using `curl` or Postman first

---

## Part 7: Cost Estimation

### Free Tier (Vercel + Render)

| Service | Resource | Monthly Limit | Estimated Usage | Cost |
|---------|----------|---------------|-----------------|------|
| Vercel | Serverless Functions | 100GB bandwidth | ~5K requests/month | $0 |
| Vercel | KV Storage | 2GB storage | ~500MB for A.L.E.C. | $0 |
| Render | Web Service | 750 hours/month | Always-on service | $0 |

**Total Monthly Cost**: **$0** (Free tier sufficient for development/testing)

### Pro Tier Recommendations

For production with >10K requests/month:

- Vercel Pro Plan: **$20/month**
- Render Standard: **$7/month**
- Additional KV Storage: **$5/month**

**Total Monthly Cost**: ~**$32/month**

---

## Part 8: Continuous Deployment Setup

### GitHub Actions for Automated Deployments

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy A.L.E.C.

on:
  push:
    branches: [ main ]
  workflow_dispatch: # Manual trigger

jobs:
  deploy-vercel:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Vercel CLI
        run: npm install --global vercel@latest
        
      - name: Deploy to Vercel
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: |
          vercel pull --yes --environment=production
          vercel deploy --prod

  render-deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Render
        env:
          RENDER_API_TOKEN: ${{ secrets.RENDER_API_TOKEN }}
        run: |
          curl -X POST https://api.render.com/deploy/srv-YOUR_SERVICE_ID \
            -H "Authorization: Bearer $RENDER_API_TOKEN"
```

---

## Next Steps After Deployment

1. **Test the deployed endpoints** using the integration test suite
2. **Configure monitoring tools** for production alerts
3. **Document your deployment** process in team wiki
4. **Set up CI/CD pipelines** for automated deployments
5. **Train team members** on cloud management procedures

---

## Support & Resources

- 📚 [Vercel Documentation](https://vercel.com/docs)
- 📚 [Render Documentation](https://render.com/docs)
- 📚 [A.L.E.C. GitHub Repository](https://github.com/YOUR_USERNAME/a-lec)
- 🐛 Report Issues: Open an issue in your repository

---

**Last Updated**: 2026-04-07  
**Version**: 1.0.0  
**Author**: A.L.E.C. Development Team