// api/storage.js - Vercel Serverless Storage API
import { storage } from '@vercel/kv';

export default async function handler(req, res) {
  const { method } = req;

  // CORS headers for frontend access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    switch (method) {
      case 'POST': // Store data
        const body = JSON.parse(req.body || '{}');
        const { key, value, timestamp, metadata } = body;
        
        if (!key || !value) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            required: ['key', 'value']
          });
        }

        // Validate key format (alphanumeric, hyphens, underscores only)
        if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
          return res.status(400).json({ 
            error: 'Invalid key format',
            message: 'Key must contain only alphanumeric characters, hyphens, and underscores'
          });
        }

        const storageData = typeof value === 'string' ? value : JSON.stringify(value);
        
        await storage.set(key, storageData, { 
          ttl: parseInt(process.env.STORAGE_TTL || '2592000'), // 30 days default TTL
          metadata: metadata || null
        });

        return res.status(200).json({ 
          success: true, 
          key, 
          timestamp: new Date().toISOString(),
          storageMode: 'vercel_kv'
        });

      case 'GET': // Retrieve data or list keys
        const { key, action } = req.query;

        if (action === 'keys') {
          try {
            const keys = await storage.keys('*');
            
            return res.status(200).json({ 
              success: true, 
              count: keys.length,
              keys: keys.map(k => ({ key: k, path: `/${k}` }))
            });
          } catch (error) {
            console.error('Key listing error:', error);
            return res.status(500).json({ 
              error: 'Key listing failed',
              message: error.message
            });
          }
        } else if (action === 'stats') {
          // Storage statistics endpoint
          try {
            const stats = await storage.info();
            
            return res.status(200).json({ 
              success: true,
              storageUsed: stats.storageUsedBytes || 0,
              keyCount: keys.length || 0,
              estimatedCost: (stats.storageUsedBytes / (1024 * 1024 * 1024) * 0.023).toFixed(4) + ' USD/month'
            });
          } catch (error) {
            return res.status(500).json({ error: 'Statistics unavailable' });
          }
        } else if (key) {
          try {
            const value = await storage.get(key);
            
            if (!value) {
              return res.status(404).json({ 
                success: false,
                error: 'Key not found',
                key
              });
            }

            // Try to parse as JSON for better UX
            let parsedValue = value;
            try {
              parsedValue = JSON.parse(value);
            } catch (e) {
              // Keep as string if not JSON
            }

            return res.status(200).json({ 
              success: true, 
              key, 
              value: parsedValue,
              retrievedAt: new Date().toISOString()
            });
          } catch (error) {
            console.error('Storage read error:', error);
            return res.status(500).json({ 
              error: 'Storage read failed',
              message: error.message
            });
          }
        } else {
          return res.status(400).json({ 
            error: 'Invalid request',
            message: 'Specify ?key= or ?action=keys'
          });
        }

      case 'PUT': // Update existing data (alias for POST)
        const updateBody = JSON.parse(req.body || '{}');
        return handler({ ...req, method: 'POST' }, res);

      case 'DELETE': // Delete data
        const deleteKey = req.query.key;
        
        if (!deleteKey) {
          return res.status(400).json({ 
            error: 'Missing key parameter',
            required: ['key']
          });
        }

        try {
          await storage.del(deleteKey);
          
          return res.status(200).json({ 
            success: true, 
            deletedKey: deleteKey,
            deletedAt: new Date().toISOString()
          });
        } catch (error) {
          if (error.message.includes('not found')) {
            return res.status(404).json({ 
              error: 'Key not found',
              key: deleteKey
            });
          }

          console.error('Storage delete error:', error);
          return res.status(500).json({ 
            error: 'Storage delete failed',
            message: error.message
          });
        }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (error) {
    console.error('Unhandled storage error:', error);
    
    // Handle specific Vercel KV errors
    if (error.code === 'KV_NOT_FOUND') {
      return res.status(404).json({ 
        error: 'Storage service unavailable',
        message: 'Vercel KV not initialized or quota exceeded'
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}