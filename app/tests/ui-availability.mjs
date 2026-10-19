import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../backend/index.mjs';
import { localUiBuild } from './local-ui-build.mjs';

// Build without cloud configuration: every account and API failure below is isolated.
const output = process.env.QA_OUTPUT_DIR;
if (output) mkdirSync(output, { recursive: true });
let browser, server, localBuild;
const failures = [];
try {
  localBuild = await localUiBuild();
  server = createServer(':memory:', { setupCode: 'isolated-availability-test', telegram: { token: '', chatId: '' }, distDir: localBuild.distDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const spaces = await (await fetch(`${base}/api/spaces`)).json();
  const room = spaces.find(space => space.name === 'Classroom 201');
  const future = new Date(); future.setDate(future.getDate() + 7);
  const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
  const reservation = { id: 501, spaceId: room.id, date, start: '09:00', end: '11:00', title: 'Test reservation', attendees: 1, source: 'booking', isMine: true, canCancel: true };
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function check(name, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    const state = { signedIn: true, failBookings: false, failMine: false, reservations: [], deferMine: null };
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, base, 'Isolated checks must never contact cloud services');
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: state.signedIn ? { id: 1, name: 'QA student', role: 'staff', status: 'approved', email: 'qa@example.invalid' } : null, csrfToken: 'isolated', setupRequired: false } });
      if (url.pathname === '/api/auth/logout') { state.signedIn = false; return route.fulfill({ json: {} }); }
      if (url.pathname === '/api/bookings/mine') {
        if (state.deferMine) await state.deferMine;
        return route.fulfill(state.failMine ? { status: 503, json: { error: 'My bookings service unavailable.' } } : { json: state.reservations });
      }
      if (url.pathname === '/api/bookings' && route.request().method() === 'POST') return route.fulfill({ status: 503, json: { error: 'Booking could not be saved. Please try again.' } });
      if (url.pathname === '/api/bookings') return route.fulfill(state.failBookings ? { status: 503, json: { error: 'Availability service unavailable.' } } : { json: state.reservations.filter(entry => entry.date >= url.searchParams.get('from') && entry.date <= url.searchParams.get('to')) });
      return route.continue();
    });
    try {
      await run(page, state);
      assert.deepEqual(runtimeErrors, []);
      assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
      console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
    finally { await context.close(); }
  }
  const go = (page, name) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();

  await check('failed availability stays unknown and retry restores booked rooms', async (page, state) => {
    state.failBookings = true;
    await page.goto(base);
    await expect(page.locator('.list-status').first()).toHaveText('Availability unknown');
    await expect(page.locator('.summary-card').first()).not.toContainText('Rooms available');
    await expect(page.locator('.space-detail .book-button')).toBeDisabled();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('.list-status').first()).toHaveText('Availability unknown');
    await page.getByRole('button', { name: 'Save to favorites', exact: true }).click();
    await go(page, 'Favorites');
    await expect(page.locator('.favorite-card .availability')).toContainText('Availability unknown');
    if (output) await page.screenshot({ path: path.join(output, 'availability-error-fixed.png'), fullPage: true });
    state.failBookings = false;
    await page.getByRole('button', { name: 'Retry availability', exact: true }).click();
    await expect(page.locator('.favorite-card .availability')).toHaveText('Available');
    await go(page, 'Find a room');
    state.reservations = [reservation];
    await page.getByLabel('Booking date', { exact: true }).fill(date);
    await page.locator('.search-bar').getByRole('button').click();
    await expect(page.locator('.space-detail')).toContainText('Booked for this time');
    await expect(page.locator('.space-detail .book-button')).toBeDisabled();
    state.failBookings = true;
    await page.locator('.search-bar').getByRole('button').click();
    await expect(page.locator('.space-detail')).toContainText('Availability unknown');
    await expect(page.locator('.space-detail .book-button')).toBeDisabled();
  });
  await check('schedule distinguishes errors, successful empty results and signed-out access', async (page, state) => {
    await page.goto(base);
    await expect(page.locator('.list-status').first()).toHaveText('Available');
    state.failBookings = true;
    await go(page, 'Schedule');
    await expect(page.getByRole('heading', { name: 'Schedule unavailable', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No scheduled entries', exact: true })).toHaveCount(0);
    state.failBookings = false;
    await page.getByRole('button', { name: 'Retry schedule', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No scheduled entries', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await go(page, 'Schedule');
    await expect(page.getByRole('heading', { name: 'Sign in to view the schedule', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No scheduled entries', exact: true })).toHaveCount(0);
  });
  await check('personal bookings show an error and recover without claiming an empty account', async (page, state) => {
    state.failMine = true;
    await page.goto(base);
    await go(page, 'My bookings');
    await expect(page.getByRole('heading', { name: 'Bookings unavailable', exact: true })).toBeVisible();
    await expect(page.getByText('Your next great idea starts here.', { exact: true })).toHaveCount(0);
    state.failMine = false; state.reservations = [reservation];
    await page.getByRole('button', { name: 'Retry my bookings', exact: true }).click();
    await expect(page.locator('.reservation')).toContainText('Test reservation');
  });
  await check('late personal-booking response cannot restore data after sign-out', async (page, state) => {
    let release;
    state.reservations = [reservation];
    state.deferMine = new Promise(resolve => { release = resolve; });
    const pending = page.waitForRequest('**/api/bookings/mine');
    await page.goto(base); await pending;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.account-identity')).toHaveCount(0);
    const completed = page.waitForResponse('**/api/bookings/mine');
    release(); await completed;
    await go(page, 'My bookings');
    await expect(page.getByRole('heading', { name: 'Sign in to view your bookings', exact: true })).toBeVisible();
    await expect(page.locator('.reservation')).toHaveCount(0);
    await expect(page.locator('.summary-card').nth(1).locator('strong')).toHaveText('0');
  });
  await check('failed submission and failed refresh disable confirmation until availability is checked', async (page, state) => {
    await page.goto(base);
    await page.locator('.space-detail').getByRole('button', { name: 'Book this room', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reserve your room', exact: true });
    await dialog.getByRole('textbox', { name: /Booking purpose/ }).fill('Regression test booking');
    state.failBookings = true;
    await dialog.getByRole('button', { name: 'Submit booking request', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Booking could not be saved.');
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    await expect(dialog).toContainText('Refresh availability before booking');
  });
  await check('dialog has a name and returns keyboard focus', async page => {
    await page.goto(base);
    const help = page.getByRole('button', { name: 'Help and support', exact: true });
    await help.click();
    const dialog = page.getByRole('dialog', { name: 'A little help finding your room', exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
  });
  await check('dropdown uses external CSS and supports keyboard and mobile selection', async page => {
    await page.goto(base);
    const floor = page.getByRole('combobox', { name: 'Floor', exact: true });
    await floor.click();
    await expect(page.getByRole('listbox', { name: 'Floor', exact: true })).toBeVisible();
    await expect(page.locator('[style]')).toHaveCount(0);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(floor).toHaveText('Floor 3');
    await expect(page.locator('.space-detail')).toContainText('Library 301');
    await page.setViewportSize({ width: 390, height: 844 });
    await floor.click();
    await page.getByRole('option', { name: 'Floor 4', exact: true }).click();
    await expect(floor).toHaveText('Floor 4');
    await expect(page.locator('.space-detail')).toContainText('Classroom 401');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (output) await page.screenshot({ path: path.join(output, 'availability-mobile-fixed.png'), fullPage: true });
  });
  assert.deepEqual(failures, [], 'Availability and accessibility regression checks');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  localBuild?.cleanup();
}
