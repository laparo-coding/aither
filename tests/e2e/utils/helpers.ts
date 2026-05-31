import type { Locator } from "@playwright/test";

export async function hasVisible(locator: Locator) {
	return locator.isVisible().catch(() => false);
}
