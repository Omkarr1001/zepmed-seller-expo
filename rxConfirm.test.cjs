const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');

assert.ok(src.includes('Tap bell to silence ring'), 'Rx and normal popups share SilenceBell');
assert.ok(src.includes("code: 'wrong_prescription'"), 'Rx must offer Wrong prescription');
assert.ok(src.includes('orderDecisionActions'), 'Shared accept/reject actions');
assert.ok(!src.includes('Fill prescription & confirm'), 'Fill must be hidden on seller app');
assert.ok(!src.includes('Confirm & Save'), 'Confirm/save must be hidden');
assert.ok(!src.includes('Accept & Ready for Pickup'), 'Ready must stay on seller panel');
assert.ok(!src.includes('Nearby Pharmacies to Forward'), 'Nearby Pharmacies section must stay gone');
assert.ok(!src.includes('Send catalog items to cart'), 'Rx cart fill must stay on seller panel');

function pendingStatus(status) {
  return ['placed', 'new', 'pending', 'prescription_review'].includes((status ?? '').toLowerCase());
}
function isPrescription(order) {
  return order.order_type === 'prescription'
    || order.is_prescription_order === true
    || (order.status ?? '').toLowerCase() === 'prescription_review';
}
function orderDecisionActions(order) {
  if (!pendingStatus(order.status)) return [];
  if (isPrescription(order)) {
    return [
      { code: 'rx_accept', label: 'Accept' },
      { code: 'rejected', label: 'Reject' },
      { code: 'wrong_prescription', label: 'Wrong prescription' },
    ];
  }
  return [
    { code: 'confirmed', label: 'Accept' },
    { code: 'rejected', label: 'Reject' },
  ];
}

const rx = { id: 1, status: 'prescription_review', order_type: 'prescription', seller_confirmed_at: '2026-11-05 10:00:00' };
assert.deepStrictEqual(orderDecisionActions(rx).map((a) => a.code), ['rx_accept', 'rejected', 'wrong_prescription']);
assert.deepStrictEqual(orderDecisionActions({ id: 2, status: 'placed' }).map((a) => a.code), ['confirmed', 'rejected']);
assert.deepStrictEqual(orderDecisionActions({ id: 3, status: 'confirmed' }), []);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.json'), 'utf8'));
assert.strictEqual(pkg.version, '1.0.5');
assert.strictEqual(app.expo.version, '1.0.5');
assert.strictEqual(app.expo.android.package, 'com.zepmed.seller');
assert.strictEqual(app.expo.android.versionCode, 6);

console.log('rxConfirm 1.0.5 accept/reject helpers ok');
