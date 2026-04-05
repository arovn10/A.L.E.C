#!/bin/bash

# A.L.E.C. API Test Script
# Tests authentication, document upload, and integrations

BASE_URL="http://localhost:3001"

echo "=========================================="
echo "  🤖 A.L.E.C. API Testing"
echo "=========================================="

# Test 1: Health Check
echo -e "\n🏥 Testing health endpoint..."
curl -s "$BASE_URL/health" | jq '.' || echo "❌ Health check failed (server may not be running)"

# Test 2: Register New User
echo -e "\n👤 Testing user registration..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test_user@example.com",
    "password": "TestPass123!",
    "settings": {
      "language": "en-US",
      "tone": "professional"
    }
  }')

echo "$REGISTER_RESPONSE" | jq '.'
TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  echo "⚠️ Registration failed or returned no token, trying admin login..."
  
  # Try admin login instead
  ADMIN_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "arovner@stoagroup.com",
      "password": "Wed75382"
    }')
  
  echo "$ADMIN_LOGIN" | jq '.'
  TOKEN=$(echo "$ADMIN_LOGIN" | jq -r '.token // empty')
fi

if [ -n "$TOKEN" ]; then
  echo -e "\n✅ Token received: ${TOKEN:0:50}..."
  
  # Test 3: Get Profile
  echo -e "\n📋 Testing profile endpoint..."
  curl -s "$BASE_URL/api/auth/profile" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
  
  # Test 4: Generate Token
  echo -e "\n🎫 Testing token generation..."
  curl -s -X POST "$BASE_URL/api/tokens/generate" \
    -H "Content-Type: application/json" \
    -d '{
      "type": "FULL_CAPABILITIES",
      "userId": "test_user_2026"
    }' | jq '.'
  
  # Test 5: Get Integrations Status
  echo -e "\n🔗 Testing integrations endpoint..."
  curl -s "$BASE_URL/api/integrations" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
  
  # Test 6: Chat with A.L.E.C.
  echo -e "\n💬 Testing chat endpoint..."
  curl -s -X POST "$BASE_URL/api/chat" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "message": "Hello, who are you? Can you help me with real estate analysis?",
      "context": {},
      "voice": false
    }' | jq '.'
  
  # Test 7: STOA Database Stats (if connected)
  echo -e "\n📊 Testing database statistics..."
  curl -s "$BASE_URL/api/data-sources/stats" \
    -H "Authorization: Bearer $TOKEN" | jq '.'
else
  echo "❌ No token received, skipping authenticated tests"
fi

echo -e "\n=========================================="
echo "  ✅ Testing Complete!"
echo "=========================================="
