import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const violations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
    (v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })
  )

test('google authentication flow, dialog, and session persistence', async ({ page }) => {
  await page.goto('/')

  // 1. Google sign-in controls should be visible on auth screen
  await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible()

  // 2. Click Google options to open the configuration & demo dialog
  const optionsBtn = page.getByRole('button', { name: 'Google authentication options' })
  await optionsBtn.click()
  const dialog = page.getByRole('dialog', { name: 'Google Authentication' })
  await expect(dialog).toBeVisible()

  // Verify dialog accessibility
  expect(await violations(page), 'dialog accessibility').toEqual([])

  // 3. Test Escape key closes dialog
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // 4. Open dialog again and perform Instant Google Sign-In
  await optionsBtn.click()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Instant Google Sign-In', exact: true }).click()

  // 5. User should be in workspace picker with authenticated Google session
  await expect(page.getByRole('button', { name: 'Open Project Folder' })).toBeVisible()
  await page.locator('.recent-row').first().click()
  await expect(page.getByRole('heading', { name: 'What are we building today?' })).toBeVisible()

  // 6. Check Profile shows Google Identity as Connected
  await page.getByRole('button', { name: 'Open profile', exact: true }).first().click()
  await expect(page.getByText('Google session connected')).toBeVisible()

  // Open Connected Services
  await page.getByRole('button', { name: 'Connected Services', exact: true }).click()
  await expect(page.getByText('Google Identity')).toBeVisible()
  await expect(page.locator('.service-row').filter({ hasText: 'Google Identity' })).toContainText('Connected')

  // 7. Verify session persistence across page reload
  await page.reload()
  // Authenticated user is preserved in picker without seeing the login page again
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open Project Folder' })).toBeVisible()
  await page.locator('.recent-row').first().click()
  await expect(page.getByRole('heading', { name: 'What are we building today?' })).toBeVisible()
  await page.getByRole('button', { name: 'Open profile', exact: true }).first().click()
  await expect(page.getByText('Google session connected')).toBeVisible()

  // 8. Sign out should clear Google session and return to Auth screen
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue in local demo mode', exact: true })).toBeVisible()
})
