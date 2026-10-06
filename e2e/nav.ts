import { expect, type Page } from '@playwright/test';

/** Opens a campaign tab; on phones the less used tabs sit behind "More". */
export async function openTab(page: Page, name: string) {
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  const more = page.getByRole('button', { name: 'More' });
  if (await more.isVisible()) await more.click();
  await page.getByRole('link', { name, exact: true }).click();
}
