CREATE TABLE `users` (
  `id` VARCHAR(191) NOT NULL, `email` VARCHAR(191) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL, `role` ENUM('OWNER','ADMIN') NOT NULL DEFAULT 'OWNER',
  `is_active` BOOLEAN NOT NULL DEFAULT true, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL, UNIQUE INDEX `users_email_key`(`email`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `sessions` (
  `id` VARCHAR(191) NOT NULL, `refresh_token_hash` VARCHAR(255) NOT NULL, `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL, `user_agent` VARCHAR(500) NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `user_id` VARCHAR(191) NOT NULL, INDEX `sessions_user_id_idx`(`user_id`), INDEX `sessions_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`), CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
