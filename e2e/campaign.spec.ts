import { expect, test } from '@playwright/test';
import { ADMIN } from './global-setup.ts';
import { openTab } from './nav.ts';

test('host logs a session, applies the conclusion and new scenarios open up', async ({
  page,
}, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Campaign name').fill(`Play ${suffix}`);
  await page.getByRole('button', { name: 'Create' }).click();

  // Starting scenarios from the (fictional) example seed.
  await page.getByRole('link', { name: 'Scenarios' }).click();
  await expect(page.getByText('Example Opening')).toBeVisible();
  await expect(page.getByText('Example Left Path')).toHaveCount(0);

  await page.getByRole('link', { name: 'Party' }).click();
  await page.getByRole('button', { name: 'New character' }).click();
  await page.getByLabel('Example Scout').check();
  await page.getByLabel('Character name').fill('Runner');
  await page.getByRole('button', { name: 'Create character' }).click();
  await expect(page.getByRole('heading', { name: 'Runner' })).toBeVisible();

  await page.getByRole('link', { name: 'Sessions' }).click();
  await page.getByRole('button', { name: 'Log a session' }).click();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('1');
  await page.getByLabel('Coins (loot)').fill('2');
  await page.getByLabel('XP (dial)').fill('3');
  await page.getByRole('button', { name: 'Apply results' }).click();
  await expect(page.getByText(/First completion/)).toBeVisible();
  await page.getByRole('link', { name: '11.1' }).click();

  // Review: set-morale is a manual step; apply the two unlocks.
  await expect(page.getByText('Unlock scenario 2 Example Left Path')).toBeVisible();
  await page.getByRole('button', { name: 'Apply section' }).click();
  await expect(page.getByText('Applied.')).toBeVisible();
  await expect(page.getByText('Set morale to the value given in the section')).toBeVisible();

  await page.getByRole('link', { name: 'Scenarios' }).click();
  await expect(page.getByText('Example Left Path')).toBeVisible();
  await page.getByRole('tab', { name: /Completed/ }).click();
  await expect(page.getByText('Example Opening')).toBeVisible();

  // The whole session shows up in the campaign history.
  await openTab(page, 'History');
  await expect(page.getByText(/^(log session|session result)/).first()).toBeVisible();
});
