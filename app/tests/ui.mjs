import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../backend/index.mjs';

// Browser plugin not available; use the repository's Playwright workflow.
// Credentials and events exist only in this isolated in-memory database.
const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || path.join(tmpdir(), 'coventry-classrooms-qa'));
mkdirSync(outputDir, { recursive: true });
const options = { setupCode: 'known-QA-only-secret', authRateLimit: 100, telegram: { token: '', chatId: '' } };
const server = createServer(':memory:', options);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
options.appOrigin = base;
const password = 'Isolated QA password 2026!';
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
const errors = [];
let browser;
function watch(page) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
const nav = page => page.getByRole('navigation', { name: 'Main navigation' });
const go = (page, label) => nav(page).getByRole('button', { name: label, exact: true }).click();
async function login(page, email, name) {
  await go(page, 'Sign in / Register');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const form = page.locator('.account-form');
  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.account-identity')).toContainText(name);
  await expect(page.getByRole('heading', { name: 'Find a classroom', exact: true })).toBeVisible();
}
async function api(page, route, method = 'GET', body) {
  const cookie = (await page.context().cookies(base)).map(item => `${item.name}=${item.value}`).join('; ');
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })).json();
  return fetch(`${base}/api${route}`, { method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...(session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function screenshot(page, filename) {
  const size = await page.evaluate(() => ({ window: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.document <= size.window, `${filename}: document overflow ${JSON.stringify(size)}`);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: true });
}
async function finder(page, floor = 'Floor 2') {
  await go(page, 'Find a classroom');
  await page.getByRole('combobox', { name: 'Building', exact: true }).click();
  await page.getByRole('option', { name: 'Science Center', exact: true }).click();
  await page.getByLabel('Floor', { exact: true }).selectOption(floor);
  await page.getByLabel('Booking date', { exact: true }).fill(date);
  await page.locator('.search-bar').getByRole('button', { name: 'Find a classroom', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Showing availability');
}
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1505, height: 1045 } });
  watch(page); await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Find a classroom', exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).origin, base); assert.match(await page.title(), /coventry/i);
  assert.equal(await page.locator('vite-error-overlay, nextjs-portal').count(), 0);
  const logo = page.getByRole('img', { name: 'Coventry University', exact: true });
  await expect(logo).toBeVisible(); assert.ok(await logo.evaluate(img => img.complete && img.naturalWidth > 0));
  await expect(page.getByLabel('Demo profile', { exact: true })).toHaveCount(0);
  await expect(page.locator('.space-detail')).toContainText('Sign in for availability');
  await go(page, 'Booking rules'); await expect(page.locator('.rules-content')).toContainText('not official Coventry University policy');
  await go(page, 'Sign in / Register'); await page.getByRole('button', { name: 'Set up administrator', exact: true }).click();
  const setup = page.locator('.account-form');
  for (const [label, value] of [['Administrator setup code', options.setupCode], ['Full name', 'QA Administrator'], ['Email', 'admin@qa.example.edu'], ['Password', password], ['Confirm password', password]]) await setup.getByLabel(label === 'Password' ? /^Password/ : label, { exact: true }).fill(value);
  await setup.getByRole('button', { name: 'Create administrator', exact: true }).click();
  await expect(page.locator('.account-identity')).toContainText('QA Administrator');
  await expect(page.getByRole('heading', { name: 'Find a classroom', exact: true })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Administration', exact: true })).toBeVisible();
  await page.locator('.account-identity').getByRole('button', { name: 'Sign out', exact: true }).click();
  await go(page, 'Sign in / Register'); await expect(page.getByRole('button', { name: 'Set up administrator', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  const form = page.locator('.account-form');
  for (const [label, value] of [['Full name', 'QA University Staff'], ['Email', 'staff@qa.example.edu'], ['Password', password], ['Confirm password', password]]) await form.getByLabel(label === 'Password' ? /^Password/ : label, { exact: true }).fill(value);
  await form.locator('select[name=role]').selectOption('staff');
  await form.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('.account-notice')).toContainText('Account created');
  await login(page, 'staff@qa.example.edu', 'QA University Staff');
  await expect(page.getByText('Awaiting administrator approval', { exact: true })).toBeVisible();
  await expect(page.locator('.space-detail').getByRole('button', { name: 'Approval required to book', exact: true })).toBeDisabled();
  const classrooms = (await (await fetch(`${base}/api/spaces`)).json()).filter(space => space.active === 1);
  assert.equal(classrooms.length, 30); assert.ok(classrooms.every(space => space.type === 'classroom'));
  const input = { spaceId: classrooms.find(space => space.name === 'Classroom 102').id, date, start: '09:00', end: '11:00', title: 'University project planning', attendees: 3 };
  assert.equal((await api(page, '/bookings', 'POST', input)).status, 403);
  const admin = await browser.newPage({ viewport: { width: 1505, height: 1045 } });
  watch(admin); await admin.goto(base); await login(admin, 'admin@qa.example.edu', 'QA Administrator'); await go(admin, 'Administration');
  const row = admin.getByRole('row').filter({ hasText: 'staff@qa.example.edu' });
  await expect(row).toContainText('University staff'); await screenshot(admin, 'accounts-desktop.png');
  await admin.setViewportSize({ width: 390, height: 844 }); await screenshot(admin, 'accounts-mobile.png');
  await row.getByRole('button', { name: 'Approve', exact: true }).click(); await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Check approval status', exact: true }).click();
  await expect(page.getByText('Awaiting administrator approval', { exact: true })).toHaveCount(0);
  await finder(page); const detail = page.locator('.space-detail');
  await expect(detail.getByRole('button', { name: 'Book this classroom', exact: true })).toBeEnabled();
  for (const [floor, name] of [['Floor 2', 'Classroom 102'], ['Floor 3', 'Classroom 104'], ['Floor 4', 'Classroom 106']]) {
    await page.getByLabel('Floor', { exact: true }).selectOption(floor); await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.getByLabel('Floor', { exact: true }).selectOption('Floor 2');
  await detail.getByRole('button', { name: 'Book this classroom', exact: true }).click();
  const dialog = page.getByRole('dialog'); const purpose = dialog.getByLabel(/Booking purpose/);
  await dialog.getByRole('button', { name: 'Confirm booking', exact: true }).click();
  assert.equal(await purpose.evaluate(input => input.validity.valueMissing), true);
  await purpose.fill(input.title); await dialog.getByLabel('Attendees', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Confirm booking', exact: true }).click();
  await page.getByRole('heading', { name: 'Your classroom is reserved.', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View my bookings', exact: true }).click(); await expect(page.locator('.reservation')).toContainText(input.title);
  const own = await (await api(page, '/bookings/mine')).json(); assert.equal(own.length, 1); assert.equal(own[0].attendees, 3); assert.equal(own[0].isMine, true);
  assert.equal((await api(page, '/bookings', 'POST', { ...input, attendees: 31 })).status, 400);
  assert.equal((await api(page, '/bookings', 'POST', { ...input, title: ' ' })).status, 400);
  await finder(page); await expect(detail).toContainText('Booked for this time');
  await page.getByLabel('Floor', { exact: true }).selectOption('Floor 3'); await expect(detail.getByRole('button', { name: 'Book this classroom', exact: true })).toBeEnabled();
  await screenshot(page, 'app-desktop.png');
  // Importing a different date must refresh that date, not the previous schedule.
  await go(admin, 'Schedule');
  const otherDay = new Date(tomorrow); otherDay.setDate(otherDay.getDate() + 2);
  const otherDate = `${otherDay.getFullYear()}-${String(otherDay.getMonth() + 1).padStart(2, '0')}-${String(otherDay.getDate()).padStart(2, '0')}`;
  await admin.getByLabel('Schedule date', { exact: true }).fill(otherDate);
  await expect(admin.getByRole('heading', { name: 'No scheduled entries', exact: true })).toBeVisible();
  await go(admin, 'Administration');
  await admin.getByRole('button', { name: 'Event schedule', exact: true }).click();
  const file = admin.locator('input[type=file]');
  const upload = csv => file.setInputFiles({ name: 'events.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await upload(`classroom,date,start,end,title,attendees\nUnknown classroom,${date},09:00,10:00,University event,2\n`);
  await admin.getByRole('button', { name: 'Preview events', exact: true }).click();
  await expect(admin.getByText('This file has errors. Correct the CSV and upload it again.', { exact: true })).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Import 1 events', exact: true })).toBeDisabled();
  await upload(`classroom,date,start,end,title,attendees\nClassroom 104,${date},09:00,11:00,University research showcase,12\n`);
  await admin.getByRole('button', { name: 'Preview events', exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Import 1 events', exact: true })).toBeEnabled(); await screenshot(admin, 'events-preview-mobile.png');
  const refreshedDates = [];
  const recordRefresh = request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/bookings' && url.searchParams.get('from') === url.searchParams.get('to')) refreshedDates.push(url.searchParams.get('from'));
  };
  admin.on('request', recordRefresh);
  await admin.getByRole('button', { name: 'Import 1 events', exact: true }).click();
  await expect(admin.getByText('1 university events imported.', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'View schedule', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'University research showcase', exact: true })).toBeVisible();
  admin.off('request', recordRefresh);
  assert.ok(refreshedDates.length > 0);
  assert.ok(refreshedDates.every(value => value === date), 'event import must refresh only the imported date');
  await go(page, 'Schedule'); await page.getByLabel('Schedule date', { exact: true }).fill(date);
  await page.getByLabel('Calendar room', { exact: true }).selectOption(String(input.spaceId));
  await expect(page.getByLabel('09:00 to 09:30: Booked', { exact: true })).toBeVisible();
  await expect(page.getByLabel('11:00 to 11:30: Free', { exact: true })).toBeVisible();
  await expect(page.locator('.calendar-day.chosen')).toHaveAttribute('aria-label', `${date}, 1 bookings`);
  await expect(page.getByRole('heading', { name: input.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'University research showcase', exact: true })).toBeVisible();
  await expect(page.getByText('University event', { exact: true })).toBeVisible();
  await page.getByLabel('Schedule date', { exact: true }).fill(''); await expect(page.getByLabel('Schedule date', { exact: true })).toHaveValue(date);
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'schedule-mobile.png');
  await finder(page, 'Floor 3'); await expect(detail).toContainText('Booked for this time');
  await expect(detail.getByRole('button', { name: 'Choose another time', exact: true })).toBeDisabled();
  assert.equal((await api(page, '/bookings', 'POST', { ...input, spaceId: classrooms.find(space => space.name === 'Classroom 104').id })).status, 409);
  const event = (await (await api(page, `/bookings?from=${date}&to=${date}`)).json()).find(entry => entry.source === 'event');
  assert.equal(event.title, 'University research showcase'); assert.equal(event.canCancel, false);
  assert.equal((await api(page, `/bookings/${event.id}`, 'DELETE', {})).status, 403);
  await screenshot(page, 'app-mobile.png'); await go(page, 'My bookings');
  await page.getByRole('button', { name: 'Cancel booking', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel booking', exact: true }).click(); await expect(page.locator('.reservation')).toHaveCount(0);
  await admin.getByRole('button', { name: 'Cancel event', exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Cancel event', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'University research showcase', exact: true })).toHaveCount(0);
  // Verify the requested Coventry inventory through real filters, search and bookings.
  await page.setViewportSize({ width: 1505, height: 1045 });
  await go(page, 'Find a classroom');
  await page.getByRole('combobox', { name: 'Building', exact: true }).click();
  await page.getByRole('option', { name: 'Coventry', exact: true }).click();
  assert.deepEqual(await page.getByLabel('Floor', { exact: true }).locator('option').allTextContents(), ['Floor 2', 'Floor 3', 'Floor 4']);
  for (const floor of [2, 3, 4]) {
    await page.getByLabel('Floor', { exact: true }).selectOption(`Floor ${floor}`);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    const names = { 204: 'Large lecture room 204', 301: 'Library 301', 302: 'Club room 302', 303: 'Large lecture room 303' };
    assert.deepEqual(await page.locator('.space-list-item strong').allTextContents(), Array.from({ length: 8 }, (_, i) => names[floor * 100 + i + 1] || `Classroom ${floor * 100 + i + 1}`));
    await page.locator('.space-list-item').last().click();
    await expect(detail.getByRole('heading', { name: `Classroom ${floor * 100 + 8}`, exact: true })).toBeVisible();
  }
  await page.getByLabel('Floor', { exact: true }).selectOption('Floor 2');
  await page.getByLabel('Booking date', { exact: true }).fill(date);
  await page.locator('.search-bar').getByRole('button', { name: 'Find a classroom', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Showing availability');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.plan-whole-room')).toHaveCount(8);
  await expect(detail.locator('.resource-scope')).toHaveText('Entire classroom');
  await expect(detail.getByRole('heading', { name: 'Amenities', exact: true })).toHaveCount(0);
  await screenshot(page, 'coventry-desktop.png');
  await detail.getByRole('button', { name: 'Book this classroom', exact: true }).click();
  await expect(dialog.getByLabel('Attendees', { exact: true })).not.toHaveAttribute('max');
  await dialog.getByRole('button', { name: 'Confirm booking', exact: true }).click();
  assert.equal(await purpose.evaluate(input => input.validity.valueMissing), true);
  await purpose.fill('Coventry room 201 project meeting');
  await dialog.getByLabel('Attendees', { exact: true }).fill('12');
  await dialog.getByRole('button', { name: 'Confirm booking', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your classroom is reserved.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
  await expect(detail).toContainText('Booked for this time');
  await page.getByRole('button', { name: /^Classroom 202,/ }).click();
  await detail.getByRole('button', { name: 'Book this classroom', exact: true }).click();
  await purpose.fill('Coventry room 202 workshop');
  await dialog.getByRole('button', { name: 'Confirm booking', exact: true }).click();
  await page.getByRole('button', { name: 'View my bookings', exact: true }).click();
  await expect(page.locator('.reservation')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Building', exact: true })).toHaveText('Coventry');
  await expect(detail).toContainText('Booked for this time');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'coventry-mobile.png');
  await go(page, 'Schedule');
  await page.getByLabel('Floor', { exact: true }).selectOption('Floor 2');
  await expect(page.getByRole('heading', { name: 'Coventry room 201 project meeting', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coventry room 202 workshop', exact: true })).toBeVisible();
  await page.getByLabel('Floor', { exact: true }).selectOption('Floor 4');
  await expect(page.getByRole('heading', { name: 'No scheduled entries', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.locator('.account-identity')).toHaveCount(0);
  assert.equal((await fetch(`${base}/api/bookings`)).status, 401); assert.deepEqual(errors, [], 'No browser errors');
  console.log('UI checks passed: administrator setup, staff registration and approval, cookie login/logout, booking purpose/capacity/cancellation, CSV preview/import/errors, unified schedule and event conflicts, floors 2/3/4, branding, desktop/mobile overflow and console health.');
  console.log(`QA screenshots: ${outputDir}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
