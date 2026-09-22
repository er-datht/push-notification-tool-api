-- CreateTable
CREATE TABLE `push_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `distribute_now` BOOLEAN NOT NULL,
    `login_ids` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_editions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `run_id` BIGINT NOT NULL,
    `deliv_id` VARCHAR(24) NOT NULL,
    `title` TEXT NOT NULL,
    `link_type` CHAR(2) NOT NULL,
    `link_item` VARCHAR(255) NOT NULL,
    `publish_at` DATETIME(3) NOT NULL,
    `file_path` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `push_editions_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `push_editions` ADD CONSTRAINT `push_editions_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `push_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
