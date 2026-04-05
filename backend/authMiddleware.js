#!/usr/bin/env node
/**
 * A.L.E.C. Authentication Middleware with Account Management
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class AuthManager {
  constructor() {
    this.users = new Map(); // In-memory user storage (replace with DB in production)
    this.adminEmail = 'arovner@stoagroup.com';
    this.adminPasswordHash = null;
  }

  async initializeAdminAccount(adminEmail, password) {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      this.users.set(adminEmail, {
        email: adminEmail,
        passwordHash: hashedPassword,
        role: 'admin',
        settings: {
          language: 'en-US',
          tone: 'professional',
          trainingDataset: 'default',
          dataAccessLevel: 'full'
        },
        createdAt: new Date().toISOString(),
        lastLogin: null
      });

      console.log(`✅ Admin account created for ${adminEmail}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to create admin account:', error.message);
      return false;
    }
  }

  async registerUser(email, password, settings = {}) {
    try {
      if (this.users.has(email)) {
        throw new Error('Email already registered');
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      this.users.set(email, {
        email: email,
        passwordHash: hashedPassword,
        role: 'user',
        settings: {
          language: settings.language || 'en-US',
          tone: settings.tone || 'professional',
          trainingDataset: settings.trainingDataset || 'default',
          dataAccessLevel: settings.dataAccessLevel || 'standard',
          ...settings
        },
        createdAt: new Date().toISOString(),
        lastLogin: null
      });

      console.log(`✅ User registered: ${email}`);
      return true;
    } catch (error) {
      throw error;
    }
  }

  async authenticateUser(email, password) {
    try {
      const user = this.users.get(email);

      if (!user) {
        throw new Error('Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        throw new Error('Invalid password');
      }

      // Update last login
      user.lastLogin = new Date().toISOString();

      return true;
    } catch (error) {
      throw error;
    }
  }

  generateToken(userId, tokenType = 'FULL_CAPABILITIES') {
    const secret = process.env.JWT_SECRET || 'your-256-bit-secret-key-for-a-l-e-c-personal-ai-system-must-be-at-least-32-characters-long';

    return jwt.sign(
      {
        userId,
        tokenType
      },
      secret,
      { expiresIn: '7d' }
    );
  }

  verifyToken(token) {
    try {
      const secret = process.env.JWT_SECRET || 'your-256-bit-secret-key-for-a-l-e-c-personal-ai-system-must-be-at-least-32-characters-long';
      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  getUserByEmail(email) {
    return this.users.get(email);
  }

  getAllUsers() {
    const users = [];
    for (const [email, user] of this.users.entries()) {
      users.push({
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        settings: user.settings
      });
    }
    return users;
  }

  updateUserSettings(email, newSettings) {
    const user = this.users.get(email);

    if (!user) {
      throw new Error('User not found');
    }

    user.settings = { ...user.settings, ...newSettings };
    console.log(`✅ Settings updated for ${email}`);
    return true;
  }

  getAdminEmail() {
    return this.adminEmail;
  }
}

const authManager = new AuthManager();

// Initialize admin account with provided credentials
async function initializeSystem() {
  await authManager.initializeAdminAccount(
    'arovner@stoagroup.com',
    'Wed75382' // Using same password as database for simplicity
  );
}

module.exports = { authManager, initializeSystem };
