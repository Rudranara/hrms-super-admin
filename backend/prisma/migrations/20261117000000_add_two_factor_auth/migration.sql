ALTER TABLE `users`
  ADD COLUMN `two_factor_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `two_factor_secret_encrypted` TEXT NULL,
  ADD COLUMN `two_factor_pending_secret_encrypted` TEXT NULL,
  ADD COLUMN `two_factor_pending_expires_at` DATETIME(3) NULL,
  ADD COLUMN `two_factor_enabled_at` DATETIME(3) NULL;

CREATE TABLE `two_factor_challenges` (
  `id` VARCHAR(191) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `type` ENUM('ENROLLMENT', 'LOGIN') NOT NULL,
  `remember_me` BOOLEAN NOT NULL DEFAULT false,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `user_id` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `two_factor_challenges_token_hash_key`(`token_hash`),
  INDEX `two_factor_challenges_user_id_expires_at_idx`(`user_id`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `two_factor_challenges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `two_factor_recovery_codes` (
  `id` VARCHAR(191) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `user_id` VARCHAR(191) NOT NULL,
  INDEX `two_factor_recovery_codes_user_id_consumed_at_idx`(`user_id`, `consumed_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `two_factor_recovery_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
