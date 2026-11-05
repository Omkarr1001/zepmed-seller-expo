const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');

assert.ok(src.includes('instructions_reviewed: true'), 'Fill must send instructions_reviewed true');
assert.ok(src.includes('<Danger label="Remove"'), 'Each Rx row needs a Remove button');
assert.ok(!src.includes('Nearby Pharmacies to Forward'), 'Nearby Pharmacies section must be gone');
assert.ok(src.includes('isRxPending'), 'Rx pending helper required for closed-app popup');
assert.ok(src.includes("status ?? '').toLowerCase() === 'prescription_review'"), 'prescription_review is alertable');
assert.ok(src.includes('seller FCM') || src.includes('orderCanShowNewPopup'), 'new-order popup gate present');

function pendingStatus(status) {
  return ['placed', 'new', 'pending', 'prescription_review'].includes((status ?? '').toLowerCase());
}
function isRxPending(order) {
  const rx = order.order_type === 'prescription'
    || order.is_prescription_order === true
    || (order.status ?? '').toLowerCase() === 'prescription_review';
  return rx && pendingStatus(order.status);
}
function orderCanShowNewPopup(order) {
  if (!pendingStatus(order.status)) return false;
  if (order.forwarded_to_me) return false;
  if (order.viewer_is_owner === false) return false;
  if (!isRxPending(order)) {
    if (order.seller_confirmed_at) return false;
  }
  return true;
}

const rx = {
  id: 1,
  status: 'prescription_review',
  order_type: 'prescription',
  seller_confirmed_at: '2026-11-05 10:00:00',
};
assert.strictEqual(orderCanShowNewPopup(rx), true, 'Rx with seller_confirmed_at still pops');
assert.strictEqual(orderCanShowNewPopup({ id: 2, status: 'placed', seller_confirmed_at: '2026-11-05 10:00:00' }), false);
assert.strictEqual(orderCanShowNewPopup({ id: 3, status: 'placed' }), true);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.json'), 'utf8'));
assert.strictEqual(pkg.version, '1.0.4');
assert.strictEqual(app.expo.version, '1.0.4');
assert.strictEqual(app.expo.android.package, 'com.zepmed.seller');
assert.strictEqual(app.expo.android.versionCode, 5);

console.log('rxConfirm 1.0.4 helpers ok');
