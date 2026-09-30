/*
  Warnings:

  - You are about to drop the column `sub_type` on the `normal_push_editions` table. All the data in the column will be lost.
  - You are about to drop the column `target_event` on the `normal_push_editions` table. All the data in the column will be lost.
  - You are about to drop the column `word_id` on the `normal_push_editions` table. All the data in the column will be lost.
  - You are about to drop the column `login_ids` on the `normal_push_runs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `normal_push_editions` DROP COLUMN `sub_type`,
    DROP COLUMN `target_event`,
    DROP COLUMN `word_id`;

-- AlterTable
ALTER TABLE `normal_push_runs` DROP COLUMN `login_ids`;

-- CreateTable
CREATE TABLE `normal_push_shows` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `edition_id` BIGINT NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `performer_id` BIGINT NOT NULL,
    `hook` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `normal_push_shows_edition_id_idx`(`edition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `normal_push_editions_publish_at_idx` ON `normal_push_editions`(`publish_at`);

-- AddForeignKey
ALTER TABLE `normal_push_shows` ADD CONSTRAINT `normal_push_shows_edition_id_fkey` FOREIGN KEY (`edition_id`) REFERENCES `normal_push_editions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
