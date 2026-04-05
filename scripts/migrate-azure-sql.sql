-- ═══════════════════════════════════════════════════════════════
-- A.L.E.C. — Azure SQL Migration Script
-- Run against: stoagroupdb.database.windows.net / campus-rentals
--
-- Creates the 'alec' schema and 4 tables with proper indexes.
-- Safe to re-run (uses IF NOT EXISTS patterns).
-- ═══════════════════════════════════════════════════════════════

-- Create schema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'alec')
BEGIN
    EXEC('CREATE SCHEMA alec');
END
GO

-- ── conversations: every chat exchange ──────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'alec.conversations') AND type = 'U')
BEGIN
    CREATE TABLE alec.conversations (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        session_id      NVARCHAR(100)   NOT NULL,
        user_message    NVARCHAR(MAX)   NOT NULL,
        alec_response   NVARCHAR(MAX)   NOT NULL,
        confidence      FLOAT           DEFAULT 0,
        model_used      NVARCHAR(100)   DEFAULT 'qwen2.5-coder-7b',
        tokens_in       INT             DEFAULT 0,
        tokens_out      INT             DEFAULT 0,
        latency_ms      INT             DEFAULT 0,
        user_rating     INT             NULL,       -- 1 = good, -1 = bad
        feedback        NVARCHAR(MAX)   NULL,
        created_at      DATETIME2       DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_conv_session   ON alec.conversations(session_id);
    CREATE INDEX IX_conv_created   ON alec.conversations(created_at);
    CREATE INDEX IX_conv_rating    ON alec.conversations(user_rating) WHERE user_rating IS NOT NULL;
END
GO

-- ── training_metrics: LoRA fine-tuning run logs ─────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'alec.training_metrics') AND type = 'U')
BEGIN
    CREATE TABLE alec.training_metrics (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        run_id          NVARCHAR(100)   NOT NULL,
        epoch           INT             NOT NULL,
        step            INT             NOT NULL,
        train_loss      FLOAT           NOT NULL,
        val_loss        FLOAT           NULL,
        perplexity      FLOAT           NULL,
        learning_rate   FLOAT           NOT NULL,
        lora_rank       INT             DEFAULT 16,
        dataset_size    INT             DEFAULT 0,
        model_version   NVARCHAR(50)    NOT NULL,
        created_at      DATETIME2       DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_tm_run     ON alec.training_metrics(run_id);
    CREATE INDEX IX_tm_created ON alec.training_metrics(created_at);
END
GO

-- ── learned_queries: SQL/code queries that succeeded or failed ──
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'alec.learned_queries') AND type = 'U')
BEGIN
    CREATE TABLE alec.learned_queries (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        query_text      NVARCHAR(MAX)   NOT NULL,
        query_type      NVARCHAR(100)   NOT NULL,
        was_successful  BIT             DEFAULT 1,
        error_message   NVARCHAR(MAX)   NULL,
        correction      NVARCHAR(MAX)   NULL,
        domain          NVARCHAR(100)   DEFAULT 'general',
        times_used      INT             DEFAULT 1,
        last_used       DATETIME2       DEFAULT SYSUTCDATETIME(),
        created_at      DATETIME2       DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_lq_domain  ON alec.learned_queries(domain);
    CREATE INDEX IX_lq_type    ON alec.learned_queries(query_type);
END
GO

-- ── evolution_log: model version changes, bias adjustments ──────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'alec.evolution_log') AND type = 'U')
BEGIN
    CREATE TABLE alec.evolution_log (
        id                      INT IDENTITY(1,1) PRIMARY KEY,
        event_type              NVARCHAR(100)   NOT NULL,
        description             NVARCHAR(MAX)   NOT NULL,
        model_version_before    NVARCHAR(50)    NULL,
        model_version_after     NVARCHAR(50)    NULL,
        metrics_snapshot        NVARCHAR(MAX)   NULL,   -- JSON blob
        created_at              DATETIME2       DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_evo_type    ON alec.evolution_log(event_type);
    CREATE INDEX IX_evo_created ON alec.evolution_log(created_at);
END
GO

PRINT '✅ A.L.E.C. schema and tables created successfully.';
GO
