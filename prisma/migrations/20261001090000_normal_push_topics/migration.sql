-- normal-push follows ecs-api's create_topics_edition (docs/create_topics_edition_flow.md):
-- the edition gets ecs-api's period_start / period_end / status / edited_at, and the topics it
-- builds are stored in normal_push_topics.
--
-- Hand-written so publish_at is RENAMED rather than dropped and re-added (Prisma's default),
-- which keeps existing rows.

-- RenameColumn / RenameIndex
ALTER TABLE `normal_push_editions` RENAME COLUMN `publish_at` TO `period_start`;
ALTER TABLE `normal_push_editions` RENAME INDEX `normal_push_editions_publish_at_idx` TO `normal_push_editions_period_start_idx`;

-- AlterTable: every edition is a one-hour window, so period_end is backfilled from period_start.
-- Rows written before this migration were answered as `edited`, so they are marked that way.
ALTER TABLE `normal_push_editions`
    ADD COLUMN `period_end` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('created', 'edited', 'set') NOT NULL DEFAULT 'created',
    ADD COLUMN `edited_at` DATETIME(3) NULL;

UPDATE `normal_push_editions`
    SET `period_end` = DATE_ADD(`period_start`, INTERVAL 1 HOUR),
        `status` = 'edited',
        `edited_at` = `created_at`;

ALTER TABLE `normal_push_editions` MODIFY `period_end` DATETIME(3) NOT NULL;

-- CreateIndex
CREATE INDEX `normal_push_editions_period_end_idx` ON `normal_push_editions`(`period_end`);

-- CreateTable
CREATE TABLE `normal_push_topics` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `edition_id` BIGINT NOT NULL,
    `subject_uri` VARCHAR(191) NOT NULL,
    `object_uri` VARCHAR(191) NOT NULL,
    `hook` VARCHAR(16) NOT NULL,
    `will_publish_at` DATETIME(3) NOT NULL,
    `area` VARCHAR(32) NOT NULL DEFAULT 'anywhere',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `normal_push_topics_edition_id_idx`(`edition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `normal_push_topics` ADD CONSTRAINT `normal_push_topics_edition_id_fkey` FOREIGN KEY (`edition_id`) REFERENCES `normal_push_editions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
