import { expect, test } from '@playwright/test';
import { ADMIN } from './global-setup.ts';

/**
 * Smoke test across the skeleton: sign in, create a campaign, invite a player who registers
 * through the invite link, and check role-based UI. Runs in a desktop and a mobile viewport.
 */
test('host creates a campaign and a player joins via invite link', async ({
  page,
  browser,
}, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  const campaignName = `Smoke ${suffix}`;

  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Your campaigns' })).toBeVisible();
  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Campaign name').fill(campaignName);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: campaignName })).toBeVisible();

  await page.getByRole('link', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await page.getByTestId('invite-link').textContent())!.trim();
  expect(link).toMatch(/\/join\//);

  // The player uses a fresh browser context (no session), as on another phone.
  const playerContext = await browser.newContext({ ...info.project.use });
  const player = await playerContext.newPage();
  await player.goto(link);
  await expect(player.getByRole('heading', { name: 'Join a campaign' })).toBeVisible();
  const playerName = `player-${suffix}`.slice(0, 32);
  await player.getByLabel('Username').fill(playerName);
  await player.getByLabel('New password (min. 10 characters)').fill('player password 1');
  await player.getByRole('button', { name: 'Create account' }).click();
  await expect(player.getByRole('heading', { name: campaignName })).toBeVisible();

  await player.getByRole('link', { name: 'Members' }).click();
  const me = player.getByRole('listitem').filter({ hasText: `@${playerName}` });
  await expect(me.getByText('Player', { exact: true })).toBeVisible();
  // Players don't get host controls.
  await expect(player.getByRole('button', { name: 'Create invite link' })).toHaveCount(0);

  // Touch targets stay usable on the phone layout.
  const box = await player.getByRole('link', { name: 'Members' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await playerContext.close();
});
