-- ============================================================
-- NodeByte Crawl — MySQL Database Schema
-- ============================================================
-- Import:  mysql -u root -p < nodebyte-crawl.sql
-- Or:      mysql -u root -p nodebyte < nodebyte-crawl.sql
--
-- .env config:
--   DATABASE_URL=mysql://user:password@localhost:3306/nodebyte
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
  `status`    VARCHAR(50)   NOT NULL DEFAULT 'scraping' COMMENT 'scraping | completed | failed',
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

-- Show what was created
SHOW TABLES;
DESCRIBE `Job`;
