import { expect, test } from '@playwright/test';
import { ADMIN } from './global-setup.ts';

test('host places markers on the mounted map and players reach the scenario from it', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'New campaign' }).click();
  await page.getByLabel('Campaign name').fill(`Map ${info.project.name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('link', { name: 'Map' }).click();
  const map = page.getByTestId('campaign-map');
  await expect(map).toBeVisible();
  await page.getByRole('button', { name: 'Place markers' }).click();

  // Markers are shared by all campaigns on the data set, so start from a known state.
  const picker = page.getByRole('combobox', { name: 'Scenario' });
  for (const n of ['0', '1', '2']) {
    await picker.selectOption(n);
    const remove = page.getByRole('button', { name: 'Remove marker' });
    if (await remove.isVisible()) await remove.click();
    await expect(remove).toBeHidden();
  }

  // Tap two spots: scenario 0 (A1), then the picker moves on to 1 (B2).
  await picker.selectOption('0');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
  await expect(page.getByTitle('0 Example Tutorial')).toBeVisible();
  await expect(picker).toHaveValue('1');
  await map.click({ position: { x: box.width * 0.45, y: box.height * 0.45 } });
  await expect(page.getByTitle('1 Example Opening')).toBeVisible();

  // Two markers calibrate the grid, so scenario 2 (C3) gets a suggested spot.
  await picker.selectOption('2');
  await page.getByRole('button', { name: 'Use grid suggestion' }).click();
  await expect(page.getByTitle('2 Example Left Path')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTitle('1 Example Opening').click();
  await page.getByRole('link', { name: 'Open scenario' }).click();
  await expect(page).toHaveURL(/\/scenarios\?open=1$/);
  await expect(page.getByRole('button', { name: /Example Opening/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
