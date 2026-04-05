#!/bin/bash
# A.L.E.C. Local Database Setup Script
# Connects to home server at 100.81.193.45 and sets up local PostgreSQL database

set -e

echo "=========================================="
echo "🏠 A.L.E.C. Local Database Setup"
echo "=========================================="
echo ""

# Configuration
HOME_SERVER_IP="100.81.193.45"
SSH_USER="${SSH_USER:-root}"  # Default to root, can be overridden
DATABASE_NAME="alec_local_db"
DATABASE_USER="alec_user"
DATABASE_PASSWORD="alec_secure_password_$(openssl rand -hex 8)"
LOCAL_DB_PATH="/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db"

echo "📍 Target Server: ${HOME_SERVER_IP}"
echo "👤 SSH User: ${SSH_USER}"
echo ""

# Step 1: Test SSH connection
echo "🔌 Testing SSH connection to home server..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${SSH_USER}@${HOME_SERVER_IP}" "echo 'Connection successful'" >/dev/null 2>&1; then
    echo "❌ Failed to connect to ${HOME_SERVER_IP} via SSH"
    echo "   Please check:"
    echo "   1. SSH server is running on the target machine"
    echo "   2. Network connectivity (ping ${HOME_SERVER_IP})"
    echo "   3. Firewall allows SSH connections (port 22)"
    exit 1
fi

echo "✅ SSH connection successful!"
echo ""

# Step 2: Check if PostgreSQL is installed on the server
echo "🔍 Checking for PostgreSQL installation..."
SSH_POSTGRES_CHECK="sudo -u postgres psql --version"
if ssh "${SSH_USER}@${HOME_SERVER_IP}" "$SSH_POSTGRES_CHECK" >/dev/null 2>&1; then
    echo "✅ PostgreSQL found on home server"
else
    echo "⚠️  PostgreSQL not found. Installing..."

    # Install PostgreSQL (assuming macOS or Linux)
    if command -v brew >/dev/null 2>&1; then
        ssh "${SSH_USER}@${HOME_SERVER_IP}" "brew install postgresql@15"
    elif command -v apt-get >/dev/null 2>&1; then
        ssh "${SSH_USER}@${HOME_SERVER_IP}" "sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib"
    else
        echo "❌ Cannot determine package manager. Please install PostgreSQL manually."
        exit 1
    fi

    echo "✅ PostgreSQL installed successfully!"
fi
echo ""

# Step 3: Start PostgreSQL service if not running
echo "🚀 Starting PostgreSQL service..."
ssh "${SSH_USER}@${HOME_SERVER_IP}" "sudo -u postgres pg_ctl start || true"
sleep 2
echo "✅ PostgreSQL should be running"
echo ""

# Step 4: Create database and user
echo "📊 Creating database '${DATABASE_NAME}'..."
ssh "${SSH_USER}@${HOME_SERVER_IP}" << EOF
sudo -u postgres psql << SQL
CREATE DATABASE ${DATABASE_NAME};
SQL

sudo -u postgres psql << SQL
CREATE USER ${DATABASE_USER} WITH PASSWORD '${DATABASE_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE ${DATABASE_NAME} TO ${DATABASE_USER};
SQL
EOF

echo "✅ Database and user created successfully!"
echo ""

# Step 5: Setup local SQLite database for personal information
echo "💾 Creating local SQLite database at ${LOCAL_DB_PATH}..."
mkdir -p "$(dirname "${LOCAL_DB_PATH}")"

sqlite3 "${LOCAL_DB_PATH}" << SQL
-- Personal Information Storage Table
CREATE TABLE IF NOT EXISTS personal_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key_name TEXT NOT NULL,
    value TEXT NOT NULL,
    metadata JSONB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, key_name)
);

-- Voice Interaction History (Local Storage)
CREATE TABLE IF NOT EXISTS voice_interactions_local (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    wake_word TEXT,
    command TEXT NOT NULL,
    response TEXT,
    success INTEGER DEFAULT 1,
    context JSONB,
    device_id TEXT,
    location TEXT
);

-- User Preferences (Local Cache)
CREATE TABLE IF NOT EXISTS user_preferences_local (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preference_name TEXT NOT NULL,
    value TEXT NOT NULL,
    type TEXT DEFAULT 'string',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(preference_name)
);

-- Smart Home Settings (Local Mirror of HA Data)
CREATE TABLE IF NOT EXISTS smart_home_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    current_state TEXT,
    preferred_states JSONB,
    automation_rules JSONB,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_personal_info_category ON personal_info(category);
CREATE INDEX IF NOT EXISTS idx_voice_interactions_time ON voice_interactions_local(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_smart_home_entity ON smart_home_settings(entity_id);

-- Insert default preferences
INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('wake_word', 'Hey Alec');
INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('voice_volume', '0.8');
INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('response_style', 'witty_and_proactive');

SQL

echo "✅ Local database created successfully at ${LOCAL_DB_PATH}"
echo ""

# Step 6: Configure environment variables
echo "🔧 Creating local database configuration..."
cat >> .env.local << EOF
# A.L.E.C. Local Database Configuration (Personal Information Storage)
ALEC_LOCAL_DB_PATH=${LOCAL_DB_PATH}
ALEC_DATABASE_HOST=100.81.193.45
ALEC_DATABASE_NAME=${DATABASE_NAME}
ALEC_DATABASE_USER=${DATABASE_USER}
ALEC_DATABASE_PASSWORD=${DATABASE_PASSWORD}

# Personal Data Storage (Local vs Cloud)
PERSONAL_DATA_STORAGE=local  # Options: local, cloud, hybrid
PERSISTENT_MEMORY_ENABLED=true
VOICE_INTERACTION_LOGGING=true
EOF

echo "✅ Local configuration file created (.env.local)"
echo ""

# Step 7: Display summary
echo "=========================================="
echo "📊 SETUP SUMMARY"
echo "=========================================="
echo ""
echo "🏠 Home Server: ${HOME_SERVER_IP}"
echo "   - PostgreSQL Database: ${DATABASE_NAME}"
echo "   - Database User: ${DATABASE_USER}"
echo "   - Password: ${DATABASE_PASSWORD} (save this!)"
echo ""
echo "💾 Local Database:"
echo "   - Path: ${LOCAL_DB_PATH}"
echo "   - Tables: 4 (personal_info, voice_interactions_local, user_preferences_local, smart_home_settings)"
echo ""
echo "🔐 Data Storage Strategy:"
echo "   - Personal Information: LOCAL storage (${LOCAL_DB_PATH})"
echo "   - STOA Group Knowledge: CLOUD storage (Azure SQL Server)"
echo "   - Voice Interactions: HYBRID (local cache + cloud backup)"
echo ""

# Step 8: Test database connectivity
echo "🧪 Testing database connectivity..."
ssh "${SSH_USER}@${HOME_SERVER_IP}" << EOF | head -20
sudo -u postgres psql ${DATABASE_NAME} -c "SELECT 'Database connection successful' as status;"
EOF

if [ $? -eq 0 ]; then
    echo "✅ Database connectivity verified!"
else
    echo "⚠️  Could not verify database connectivity"
fi
echo ""

# Step 9: Create backup script
echo "📦 Creating automated backup script..."
cat > scripts/backup-local-database.sh << 'BACKUP_SCRIPT'
#!/bin/bash
# A.L.E.C. Local Database Backup Script

LOCAL_DB_PATH="${ALEC_LOCAL_DB_PATH:-/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db}"
BACKUP_DIR="/Users/alec/Desktop/App Development/A.L.E.C/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

sqlite3 "$LOCAL_DB_PATH" ".backup '$BACKUP_DIR/alec_local_${TIMESTAMP}.db'"

echo "✅ Backup created: ${BACKUP_DIR}/alec_local_${TIMESTAMP}.db"
BACKUP_SCRIPT

chmod +x scripts/backup-local-database.sh
echo "✅ Backup script created at scripts/backup-local-database.sh"
echo ""

# Step 10: Create restore script
echo "🔄 Creating database restore script..."
cat > scripts/restore-local-database.sh << 'RESTORE_SCRIPT'
#!/bin/bash
# A.L.E.C. Local Database Restore Script

LOCAL_DB_PATH="${ALEC_LOCAL_DB_PATH:-/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db}"
BACKUP_DIR="/Users/alec/Desktop/App Development/A.L.E.C/backups"
RESTORE_FILE="$1"

if [ -z "$RESTORE_FILE" ]; then
    echo "Usage: $0 <backup_file>"
    exit 1
fi

if [ ! -f "$RESTORE_FILE" ]; then
    echo "❌ Backup file not found: $RESTORE_FILE"
    exit 1
fi

# Create backup of current database before restore
cp "$LOCAL_DB_PATH" "${LOCAL_DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"

sqlite3 "$LOCAL_DB_PATH" ".restore '$RESTORE_FILE'"

echo "✅ Database restored from: $RESTORE_FILE"
RESTORE_SCRIPT

chmod +x scripts/restore-local-database.sh
echo "✅ Restore script created at scripts/restore-local-database.sh"
echo ""

# Final instructions
echo "=========================================="
echo "📝 NEXT STEPS"
echo "=========================================="
echo ""
echo "1. Save your database password:"
echo "   ${DATABASE_PASSWORD}"
echo ""
echo "2. Update .env.local with these credentials and restart A.L.E.C."
echo ""
echo "3. Test local database functionality:"
echo "   node scripts/test-local-database.js"
echo ""
echo "4. Run automated backups daily using:"
echo "   ./scripts/backup-local-database.sh"
echo ""
echo "5. Configure A.L.E.C. to use both databases:"
echo "   - Local: Personal info, preferences, voice interactions cache"
echo "   - Cloud (Azure): STOA Group knowledge, model training data"
echo ""

echo "🎉 Setup complete! Your local database is ready."