import { expect, test } from '@playwright/test';
import { ADMIN } from './global-setup.ts';

test('a player keeps a character sheet and can undo a change', async ({ page }, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Campaign name').fill(`Chars ${suffix}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('link', { name: 'Party' }).click();
  await page.getByRole('button', { name: 'New character' }).click();

  // Fictional example seed: two starting classes, one locked class that is not offered.
  await expect(page.getByLabel('Example Locked Class')).toHaveCount(0);
  await page.getByLabel('Example Guardian').check();
  await page.getByLabel('Character name').fill('Brave');
  await page.getByRole('button', { name: 'Create character' }).click();
  await expect(page.getByRole('heading', { name: 'Brave' })).toBeVisible();

  const gold = page.getByText('Gold', { exact: true }).locator('..');
  await expect(gold).toContainText('12');
  await page.getByRole('button', { name: 'Gold +1' }).click();
  await page.getByRole('button', { name: 'Gold +1' }).click();
  await expect(gold).toContainText('14');

  // R-CHAR-07: level-ups happen in an outpost phase - the host starts one from the overview.
  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Start outpost phase' }).click();
  await expect(page.getByText(/Outpost phase in progress/)).toBeVisible();
  await page.getByRole('link', { name: 'Party' }).click();
  await page.getByRole('link', { name: /Brave/ }).click();

  // Earn enough XP, level up, spend the perk mark.
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Experience +1' }).click();
  await page.getByRole('button', { name: 'Level up', exact: true }).click();
  await expect(page.getByText('Level 2').first()).toBeVisible();
  await page.getByRole('button', { name: 'Example perk three 1' }).click();
  await expect(page.getByText(/Perk marks: 0 available/)).toBeVisible();

  // Undo the last gold change from the history.
  await page.getByRole('button', { name: 'History' }).click();
  const goldChange = page.getByRole('listitem').filter({ hasText: 'Gold: 13 → 14' });
  await goldChange.getByRole('button', { name: 'Revert' }).click();
  await expect(goldChange).toContainText('reverted');
  await page.goBack();
  await expect(page.getByText('Gold', { exact: true }).locator('..')).toContainText('13');
});
