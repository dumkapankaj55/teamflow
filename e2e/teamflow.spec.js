const { test, expect } = require('@playwright/test');

test('creates an account, workspace, project, and assigned task from the UI', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const name = 'Playwright Teammate';
  const projectName = `E2E Project ${suffix}`;
  const taskName = `E2E Task ${suffix}`;

  await page.goto('/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Work email').fill(`teamflow-${suffix}@example.test`);
  await page.getByLabel('Workspace name').fill(`E2E Workspace ${suffix}`);
  await page.getByLabel('Password').fill('TeamFlow!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/i })).toBeVisible();

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  await page.getByRole('link', { name: 'My tasks' }).click();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task name').fill(taskName);
  await page.getByLabel('Project').selectOption({ label: projectName });
  await page.getByRole('dialog').getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task status' })).toBeVisible();
  await expect(page.getByRole('link', { name: /view plans/i })).toHaveCount(0);
});

test('shows the responsive navigation menu on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Mobile Teammate');
  await page.getByLabel('Work email').fill(`mobile-${suffix}@example.test`);
  await page.getByLabel('Workspace name').fill(`Mobile Workspace ${suffix}`);
  await page.getByLabel('Password').fill('TeamFlow!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/i })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByText('Analytics will grow with your team')).toBeVisible();
});
