-- ============================================================
-- NodeByte Crawl — MySQL Database Schema (v4.0.8)
-- ============================================================
-- Import:  mysql -u root -p < nodebyte-crawl.sql
-- Or:      mysql -u root -p nodebyte < nodebyte-crawl.sql
--
-- .env config:
--   DATABASE_URL=mysql://user:password@localhost:3306/nodebyte
--
-- The Job table stores async crawl/batch job state so jobs
-- survive server restarts. Status values:
--   'pending'    — crawl is in sitemap-discovery phase
--   'scraping'   — BFS loop is actively scraping pages
--   'completed'  — job finished (success or partial failure)
--   'failed'     — job crashed or was cancelled
-- ============================================================

CREATE DATABASE IF NOT EXISTS `nodebyte`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `nodebyte`;

-- ------------------------------------------------------------
-- Job table: stores async crawl/batch job state
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Job` (
  `id`        VARCHAR(191)  NOT NULL              COMMENT 'Job ID: crawl_xxx or batch_xxx',
  `type`      VARCHAR(50)   NOT NULL              COMMENT 'Job type: crawl | batch',
  `status`    VARCHAR(50)   NOT NULL DEFAULT 'pending' COMMENT 'pending | scraping | completed | failed',
  `total`     INT           NOT NULL DEFAULT 0   COMMENT 'Total pages to scrape',
  `completed` INT           NOT NULL DEFAULT 0   COMMENT 'Pages completed so far',
  `data`      LONGTEXT      NOT NULL              COMMENT 'JSON array of per-URL results',
  `error`     TEXT          NULL                  COMMENT 'Error message if failed',
  `createdAt` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3)   NOT NULL              COMMENT 'When to auto-delete this job',
  PRIMARY KEY (`id`),
  INDEX `Job_expiresAt_idx` (`expiresAt`),
  INDEX `Job_status_idx` (`status`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='NodeByte Crawl — async job storage';

-- Migration: existing v4.0.7-and-earlier tables had status default
-- 'scraping'. Update it to 'pending' to match the new JobStatus
-- (the server now creates jobs in 'pending' state while sitemap
-- discovery runs, then flips to 'scraping' once BFS starts). This
-- ALTER is safe — it only changes the column DEFAULT for new rows;
-- existing rows keep their current values.
ALTER TABLE `Job`
  MODIFY COLUMN `status` VARCHAR(50) NOT NULL DEFAULT 'pending'
  COMMENT 'pending | scraping | completed | failed';

-- Show what was created
SHOW TABLES;
DESCRIBE `Job`;
