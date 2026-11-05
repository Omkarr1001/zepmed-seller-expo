const assert = require('assert');
const fs = require('fs');
const path = require('path');

function mergeRejectedSnaps(orders, snaps) {
  const byId = new Map(orders.map((order) => [order.id, order]));
  for (const snap of snaps) {
    const id = Number(snap?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const forced = { ...snap, id, status: 'rejected' };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, forced);
      continue;
    }
    const status = String(existing.status || '').toLowerCase();
    if (status !== 'rejected' && status !== 'cancelled') {
      byId.set(id, { ...existing, ...forced, status: 'rejected' });
    }
  }
  return [...byId.values()];
}

const api = [
  { id: 1, status: 'placed', order_number: 'ORD-1' },
  { id: 2, status: 'delivered', order_number: 'ORD-2' },
  { id: 9, status: 'rejected', order_number: 'RX-9' },
];
const snaps = [
  { id: 1, order_number: 'ORD-1', total_amount: 120, customer_name: 'Sam' },
  { id: 7, order_number: 'ORD-7', total_amount: 80, customer_name: 'Ravi' },
];
const merged = mergeRejectedSnaps(api, snaps);
const byId = Object.fromEntries(merged.map((row) => [row.id, row]));

assert.strictEqual(byId[1].status, 'rejected');
assert.strictEqual(byId[1].customer_name, 'Sam');
assert.strictEqual(byId[2].status, 'delivered');
assert.strictEqual(byId[7].status, 'rejected');
assert.strictEqual(byId[7].order_number, 'ORD-7');
assert.strictEqual(byId[9].status, 'rejected');

const alreadyCancelled = mergeRejectedSnaps(
  [{ id: 3, status: 'cancelled', order_number: 'ORD-3' }],
  [{ id: 3, order_number: 'ORD-3' }],
);
assert.strictEqual(alreadyCancelled[0].status, 'cancelled');

function screenOffShouldPlaySound(muted, appState) {
  return !muted && appState === 'active';
}
assert.strictEqual(screenOffShouldPlaySound(false, 'active'), true);
assert.strictEqual(screenOffShouldPlaySound(false, 'background'), false);
assert.strictEqual(screenOffShouldPlaySound(false, 'inactive'), false);
assert.strictEqual(screenOffShouldPlaySound(true, 'active'), false);

const src = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
assert.ok(src.includes("['rejected', 'Rejected']"));
assert.ok(src.includes('mergeRejectedIntoOrders'));
assert.ok(src.includes('rememberRejectedOrder'));
assert.ok(src.includes('hydrateRejectedOrders'));
assert.ok(src.includes('shouldPlaySound: !muted && !screenOff'));
assert.ok(src.includes('FCM_QUIET_CHANNEL_KEY'));
assert.ok(src.includes('refresh(empty ? false : true, true)'));
assert.ok(!src.includes('if (!dash) return <CenteredLoader />'));
const bell = fs.readFileSync(path.join(__dirname, 'orderBell.ts'), 'utf8');
assert.ok(bell.includes("AppState.currentState !== 'active'"));
assert.ok(bell.includes('Vibration.vibrate([0, 400, 150, 400, 150, 500], false)'));

console.log('rejected merge + screen-off sound gate ok');
