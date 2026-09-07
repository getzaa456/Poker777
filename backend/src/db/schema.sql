-- ============================================================
--  Poker777 - Core API schema (Phase 1+)
--  Owner: Core API team. Game team owns Redis table-state keys.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(30)  NOT NULL,
  `email`         VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(60)  NOT NULL,           -- bcrypt
  `display_name`  VARCHAR(40)  NULL,
  `avatar_id`     VARCHAR(40)  NULL,
  `created_at`    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- wallets ----------
-- 1 row per user. balance stored as INT (chips are whole units).
CREATE TABLE IF NOT EXISTS `wallets` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `balance`    INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_wallets_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_wallets_balance` CHECK (`balance` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- transactions ----------
-- Append-only ledger. Every chip movement must produce a row.
CREATE TABLE IF NOT EXISTS `transactions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `type`           ENUM('TOPUP','BONUS','SETTLE','BUYIN') NOT NULL,
  `amount`         INT NOT NULL,                    -- positive = credit, negative = debit
  `balance_after`  INT UNSIGNED NOT NULL,
  `ref_id`         VARCHAR(60) NOT NULL,            -- idempotency key (hand_id / topup_id / 'register:'+user_id)
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_transactions_ref` (`ref_id`),       -- idempotency: one effect per ref
  KEY `idx_transactions_user_time` (`user_id`, `created_at`),
  CONSTRAINT `fk_transactions_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- tables (lobby) ----------
CREATE TABLE IF NOT EXISTS `tables` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_code`  CHAR(6) NOT NULL,
  `name`       VARCHAR(60) NOT NULL,
  `host_id`    BIGINT UNSIGNED NOT NULL,
  `min_bet`    INT UNSIGNED NOT NULL DEFAULT 10,
  `max_bet`    INT UNSIGNED NOT NULL DEFAULT 1000,
  `max_seats`  TINYINT UNSIGNED NOT NULL DEFAULT 6,
  `status`     ENUM('OPEN','CLOSED','IN_PROGRESS') NOT NULL DEFAULT 'OPEN',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tables_room_code` (`room_code`),
  KEY `idx_tables_status` (`status`),
  CONSTRAINT `fk_tables_host` FOREIGN KEY (`host_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
