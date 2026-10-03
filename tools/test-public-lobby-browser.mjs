// Optional browser acceptance checks. PLAYWRIGHT_MODULE may point to a temporary install.
import assert from 'node:assert/strict';
import { once } from 'node:events';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
Object.assign(process.env, { PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost', EDIT_PASSWORD: 'test-only' });
const { server, wss, loop, rooms, clock } = await import('../server.js');
clearInterval(loop);
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const context = async () => {
  const c = await browser.newContext();
  c.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  return c;
};
const waitRooms = async count => {
  for (let i = 0; i < 100; i++) {
    const list = (await (await fetch(base + '/api/rooms')).json()).rooms;
    if (list.length === count) return list;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Unexpected public room count');
};
try {
  const quick = await (await context()).newPage();
  await quick.goto(base);
  await quick.waitForFunction(() => document.querySelector('#connection')?.textContent.includes('Live'));
  await quick.getByRole('button', { name: 'Quick Play' }).click();
  await quick.waitForURL('**/play?**');
  assert.equal((await waitRooms(1))[0].title, 'Open skirmish', 'Quick Play creates a public room when empty');
  await quick.close();
  await waitRooms(0);
  const host = await (await context()).newPage();
  await host.goto(base);
  await host.getByRole('textbox', { name: 'Your name' }).fill('Host');
  await host.getByRole('textbox', { name: 'Match name' }).fill('Browser acceptance');
  await host.getByRole('button', { name: 'Create match', exact: true }).click();
  await host.waitForURL('**/play?**');
  await host.locator('#lobbyMsg').waitFor();
  const [room] = await waitRooms(1);
  assert.equal(room.title, 'Browser acceptance');
  assert.equal(await host.locator('#name').inputValue(), 'Host');
  assert.ok((await host.locator('#link').inputValue()).endsWith('/play#' + room.code));

  const guest = await (await context()).newPage();
  await guest.goto(base);
  await guest.getByRole('button', { name: 'Join Browser acceptance' }).waitFor();
  await guest.screenshot({ path: '/tmp/ww2-public-lobby-desktop.png', fullPage: true });
  await guest.locator('#nickname').fill('Guest');
  await guest.getByRole('button', { name: 'Quick Play' }).click();
  await guest.waitForURL('**/play?**');
  assert.equal(new URL(guest.url()).hash, '#' + room.code);
  await guest.waitForFunction(() => document.querySelector('#name')?.value === 'Guest' && document.querySelector('#roster')?.textContent.includes('Host'));
  assert.equal((await waitRooms(1))[0].humans, 2);

  const privatePage = await (await context()).newPage();
  await privatePage.goto(base);
  await privatePage.locator('#visibility').selectOption('unlisted');
  await privatePage.getByRole('button', { name: 'Create match', exact: true }).click();
  await privatePage.waitForURL('**/play?**');
  await privatePage.locator('#lobbyMsg').waitFor();
  assert.equal((await waitRooms(1)).length, 1);

  const legacy = await (await context()).newPage();
  await legacy.goto(base + '/#oldroom&seat=second');
  await legacy.waitForURL('**/play#oldroom&seat=second');
  await legacy.locator('#lobbyMsg').waitFor();

  const mobile = await (await context()).newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base);
  await mobile.getByRole('button', { name: 'Join Browser acceptance' }).waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no mobile page overflow');
  await mobile.screenshot({ path: '/tmp/ww2-public-lobby-mobile.png', fullPage: true });
  await mobile.locator('#modeFilter').selectOption('horde');
  assert.equal(await mobile.locator('#empty').textContent(), 'No matches fit these filters.');
  await mobile.route('**/api/rooms', r => r.abort());
  await mobile.getByRole('button', { name: 'Refresh', exact: true }).click();
  await mobile.waitForFunction(() => document.querySelector('#connection')?.textContent === 'Offline');
  assert.equal(await mobile.locator('#matches tr').count(), 0, 'offline directory clears stale join actions');
  assert.deepEqual(errors, [], 'no page JavaScript errors');
  console.log('Browser acceptance passed: public create, two-player Quick Play, unlisted room, invite link, legacy seat link, mobile layout, filters and offline state.');
} finally {
  await browser.close();
  for (const ws of wss.clients) ws.terminate();
  await new Promise(r => wss.close(r));
  await new Promise(r => server.close(r));
  for (const room of rooms.values()) for (const p of room.players) clock.clearTimeout(p.cleanupTimer);
}
