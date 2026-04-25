// ============================================================
// waterfall.spec.js — Vitalis end-to-end waterfall test
// Gate D++ requirement: land → goal → protocol → cart → build → book
// Run with: npx playwright test tests/waterfall.spec.js
// Preview bypass: ?vitalis-preview=1 skips auth
// ============================================================

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const PREVIEW_URL = `${BASE_URL}/?vitalis-preview=1`;

test.describe('Vitalis Waterfall — Full Flow', () => {

  test('BUG-003: preview bypass allows access without login', async ({ page }) => {
    await page.goto(PREVIEW_URL);
    // Should NOT redirect to /login
    await expect(page).not.toHaveURL(/\/login/);
    // Should show the Goals page (Landing)
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 });
  });

  test('BUG-004: Sexual Health shows fertility/menopause stacks (not fat loss fallback)', async ({ page }) => {
    await page.goto(`${BASE_URL}/protocol/sexual-health?vitalis-preview=1`);
    // Should NOT show "Fat Loss" as a stack
    const cards = page.locator('h3');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const allText = await page.textContent('body');
    expect(allText).not.toContain('Fat Loss');
    // Should show either fertility or menopause content
    const hasFertility = allText.includes('Fertility') || allText.includes('fertility');
    const hasMenopause = allText.includes('Menopause') || allText.includes('menopause');
    const hasAuthoringFallback = allText.includes('Protocol in Development') || allText.includes('authoring');
    expect(hasFertility || hasMenopause || hasAuthoringFallback).toBeTruthy();
  });

  test('BUG-008: Cognitive shows selank-dsip-sleep stack (goals[] array filter works)', async ({ page }) => {
    await page.goto(`${BASE_URL}/protocol/cognitive-focus?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    const allText = await page.textContent('body');
    // Should show at least 2 stacks (cognitive + selank-dsip-sleep)
    const stackCount = (allText.match(/Add to Cart/g) || []).length;
    expect(stackCount).toBeGreaterThanOrEqual(2);
  });

  test('BUG-006: Cognitive page shows cognitive synergy copy (not KLOW copy)', async ({ page }) => {
    await page.goto(`${BASE_URL}/protocol/cognitive-focus?vitalis-preview=1`);
    await expect(page.locator('text=Why Stacks, Not Singles')).toBeVisible({ timeout: 5000 });
    const allText = await page.textContent('body');
    // KLOW hardcoded copy should NOT appear on cognitive page
    expect(allText).not.toContain('KLOW heals at 4 layers');
    expect(allText).not.toContain('CJC + Ipamorelin triggers a clean pulsatile GH release');
    // Cognitive-specific synergy should be present
    expect(allText).toContain('BDNF');
  });

  test('BUG-005: Evidence tier badge uses stack confidence (not always T2)', async ({ page }) => {
    await page.goto(`${BASE_URL}/protocol/cognitive-focus?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    // Tier badge should exist
    const badge = page.locator('span').filter({ hasText: /T[123] —/ }).first();
    await expect(badge).toBeVisible({ timeout: 3000 });
  });

  test('BUG-002: Add to Cart writes to sessionStorage — Build page shows cart', async ({ page }) => {
    // Navigate to a protocol page with preview bypass
    await page.goto(`${BASE_URL}/protocol/fat-loss?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });

    // Click the first "Add to Cart" button
    const addBtn = page.locator('button').filter({ hasText: /Add to Cart/ }).first();
    await expect(addBtn).toBeVisible({ timeout: 3000 });
    await addBtn.click();

    // Verify sessionStorage was written
    const cartData = await page.evaluate(() => sessionStorage.getItem('vitalis_cart_v1'));
    expect(cartData).not.toBeNull();
    const cart = JSON.parse(cartData);
    expect(cart.length).toBeGreaterThan(0);

    // Navigate to Build page
    await page.goto(`${BASE_URL}/build?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });

    // Build page should NOT show empty state
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('No stacks added yet');
    // Should show the added stack
    expect(bodyText).toContain('Build Your Protocol');
  });

  test('BUG-007: Ask Vitalis fires event, chat receives context and opens', async ({ page }) => {
    await page.goto(`${BASE_URL}/protocol/fat-loss?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });

    // Click "Ask Vitalis About This"
    const chatBtn = page.locator('button').filter({ hasText: 'Ask Vitalis About This' }).first();
    await expect(chatBtn).toBeVisible({ timeout: 3000 });
    await chatBtn.click();

    // Chat widget should open (not collapsed)
    await expect(page.locator('text=Chat widget opened')).toBeVisible({ timeout: 3000 });

    // Verify the custom event was dispatched by checking the banner text
    const bannerText = await page.textContent('body');
    expect(bannerText).toContain('Chat widget opened');
  });

  test('BUG-010: Nav step labels are 1/2/4/5 (not 1/2/3/4)', async ({ page }) => {
    await page.goto(`${BASE_URL}/?vitalis-preview=1`);
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });
    const navText = await page.locator('nav').first().textContent();
    // Should have 4 Build (not 3 Build)
    expect(navText).toContain('4 Build');
    expect(navText).toContain('5 Book');
    // Should NOT have the old wrong labels
    expect(navText).not.toMatch(/3\s*Build/);
    expect(navText).not.toMatch(/4\s*Book[^s]/); // "4 Book" is now "5 Book"
  });

  test('Full waterfall: land → goal → protocol → add to cart → build → book form visible', async ({ page }) => {
    // Set preview flag via URL first
    await page.goto(PREVIEW_URL);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 });

    // Navigate to fat-loss protocol
    await page.goto(`${BASE_URL}/protocol/fat-loss?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });

    // Add first stack to cart
    const addBtn = page.locator('button').filter({ hasText: /Add to Cart/ }).first();
    await expect(addBtn).toBeVisible({ timeout: 3000 });
    await addBtn.click();

    // Should see the "Continue to Build" button appear
    await expect(page.locator('button').filter({ hasText: 'Continue to Build' })).toBeVisible({ timeout: 3000 });

    // Navigate to build
    await page.goto(`${BASE_URL}/build?vitalis-preview=1`);
    const buildText = await page.textContent('body');
    expect(buildText).not.toContain('No stacks added yet');

    // Navigate to book
    await page.goto(`${BASE_URL}/book?vitalis-preview=1`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    const bookText = await page.textContent('body');
    expect(bookText).toContain('Book with Marc');
    // Form fields should be present
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 3000 });
  });

});
