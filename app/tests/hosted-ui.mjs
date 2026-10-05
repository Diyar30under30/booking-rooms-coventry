// Run against a disposable approved admin account; never use a real account here.
// Required: SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD, VITE_SUPABASE_URL,
// VITE_SUPABASE_PUBLISHABLE_KEY. BASE_URL optionally targets an existing deployment.
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const { SUPABASE_TEST_EMAIL: email, SUPABASE_TEST_PASSWORD: password, VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = process.env;
if (!email || !password || !url || !key) throw new Error('Set the four hosted QA environment variables.');
const client = createClient(url, key, { auth: { persistSession: false } });
const login = await client.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
const server = process.env.BASE_URL ? null : await preview({ configFile: false, root: process.cwd(), build: { outDir: 'preview-dist' }, preview: { host: '127.0.0.1', port: 4179 } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const title = `Hosted QA ${randomUUID()}`;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4179');
  await page.getByRole('button', { name: 'Sign in / Register', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Explore classrooms', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Administration', exact: true }).click();
  await page.getByRole('button', { name: 'Event schedule', exact: true }).click();
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.locator('input[type=file]').setInputFiles({ name: 'qa.csv', mimeType: 'text/csv', buffer: Buffer.from(`classroom,date,start,end,title,attendees\nClassroom 201,${date},09:00,10:00,${title},2\n`) });
  await page.getByRole('button', { name: 'Preview events', exact: true }).click();
  const importButton = page.getByRole('button', { name: 'Import 1 events', exact: true });
  await expect(importButton).toBeEnabled({ timeout: 15000 }); await importButton.click();
  await expect(page.getByText('1 university events imported.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const room = await client.from('spaces').select('id').eq('name', 'Classroom 201').eq('building', 'Coventry').single();
  if (room.error) throw room.error;
  const reservation = { spaceId: room.data.id, date, start: '10:00', end: '11:00', title, attendees: 1, userId: login.data.user.id, source: 'booking' };
  const booked = await client.from('bookings').insert(reservation).select('id').single();
  if (booked.error) throw booked.error;
  const conflict = await client.from('bookings').insert({ ...reservation, start: '10:30', end: '11:30' });
  if (conflict.error?.code !== '23P01') throw new Error('Overlapping booking was not rejected.');
  const cancelled = await client.from('bookings').delete().eq('id', booked.data.id).select('id');
  if (cancelled.error || cancelled.data.length !== 1) throw new Error('Reservation cancellation failed.');
  await page.getByLabel('Calendar room', { exact: true }).selectOption(String(room.data.id));
  await expect(page.getByLabel('09:00 to 09:30: Booked', { exact: true })).toBeVisible();
  await expect(page.getByLabel('11:00 to 11:30: Free', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile overflow');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.account-identity')).toHaveCount(0);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Hosted UI passed: email login, admin CSV preview/import, booking/conflict/cancellation, live calendar booked/free slots, mobile layout and sign-out.');
} finally {
  const cleanup = await client.from('bookings').delete().eq('userId', login.data.user.id).eq('title', title);
  await client.auth.signOut(); await browser.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  if (cleanup.error) throw cleanup.error;
}
