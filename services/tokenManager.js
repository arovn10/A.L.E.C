/**
 * Token Manager - JWT-based Authentication System
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class TokenManager {
  constructor() {
    this.secretKey = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    console.log('🔐 Token Manager initialized');
  }

  generateToken(userId, tokenType, permissions = []) {
    const payload = {
      userId,
      tokenType,
      permissions,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const token = jwt.sign(payload, this.secretKey);

    return {
      token,
      userId,
      tokenType,
      permissions,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.secretKey);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  getPermissions(tokenType) {
    const permissions = {
      STOA_ACCESS: ['stoa_data', 'basic_chat'],
      FULL_CAPABILITIES: [
        'stoa_data',
        'full_access',
        'neural_training',
        'smart_home',
        'voice_interface',
        'mcp_skills'
      ]
    };

    return permissions[tokenType] || [];
  }

  hasPermission(tokenPayload, requiredPermission) {
    return tokenPayload.permissions.includes(requiredPermission);
  }

  generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = { TokenManager };
