CREATE TABLE `relay_pixels` (
	`position` integer PRIMARY KEY NOT NULL,
	`browser` text NOT NULL,
	`share` text NOT NULL,
	`invited_by` text,
	`created` integer NOT NULL,
	`message` text,
	`handle` text
);

CREATE UNIQUE INDEX `relay_pixels_browser_unique` ON `relay_pixels` (`browser`);
CREATE UNIQUE INDEX `relay_pixels_share_unique` ON `relay_pixels` (`share`);
