-- CreateTable
CREATE TABLE `normal_push_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `distribute_now` BOOLEAN NOT NULL,
    `login_ids` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `normal_push_editions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `run_id` BIGINT NOT NULL,
    `sub_type` VARCHAR(16) NOT NULL,
    `target_event` VARCHAR(64) NOT NULL,
    `word_id` INTEGER NOT NULL,
    `publish_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `normal_push_editions_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `normal_push_editions` ADD CONSTRAINT `normal_push_editions_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `normal_push_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
