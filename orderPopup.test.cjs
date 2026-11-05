const assert = require('assert');
const fs = require('fs');
const path = require('path');

function positiveAmount(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
function orderBillAmount(order) {
  if (!order) return 0;
  return positiveAmount(
    order.total_amount,
    order.customer_payable,
    order.cod_collect_amount,
    order.grand_total,
    order.bill_total,
    order.amount,
    order.invoice && order.invoice.total_amount,
    order.subtotal,
    order.invoice && order.invoice.subtotal,
    order.seller_payout_amount,
  );
}
function orderCustomerName(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.toLowerCase() !== 'customer') return text;
  }
  return '';
}
function mergeIncomingOrder(prev, next) {
  const merged = { ...(prev || {}), ...next };
  const amount = orderBillAmount(merged) || orderBillAmount(prev) || orderBillAmount(next);
  const name = orderCustomerName(next.customer_name, prev && prev.customer_name) || next.customer_name || (prev && prev.customer_name) || null;
  return { ...merged, total_amount: amount, customer_name: name };
}
function popupDecisionActions(order) {
  const status = String(order.status || '').toLowerCase();
  const pending = ['placed', 'new', 'pending', 'prescription_review'].includes(status);
  if (!pending) return [];
  const rx = order.order_type === 'prescription' || order.is_prescription_order === true || status === 'prescription_review';
  const confirmed = String(order.seller_confirmed_at || '').trim();
  const already = confirmed !== '' && confirmed !== '0000-00-00 00:00:00' && confirmed.toLowerCase() !== 'null';
  const actions = [];
  if (!(rx && already)) actions.push({ code: rx ? 'rx_accept' : 'confirmed', label: 'Accept' });
  actions.push({ code: 'rejected', label: 'Reject' });
  if (rx) actions.push({ code: 'wrong_prescription', label: 'Wrong prescription' });
  const seen = new Set();
  return actions.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

const live = {
  id: 2151,
  order_number: 'ORD-261105-C4B13',
  status: 'placed',
  total_amount: 525.08,
  customer_payable: 525.08,
  cod_collect_amount: 525.08,
  subtotal: 512.1,
  seller_payout_amount: 512.1,
  customer_name: 'Sam',
};
const stub = { id: 2151, order_number: 'ORD-261105-C4B13', status: 'placed', total_amount: 0, customer_name: null };

assert.strictEqual(orderBillAmount(stub), 0);
assert.strictEqual(orderBillAmount(live), 525.08);
assert.strictEqual(mergeIncomingOrder(stub, live).total_amount, 525.08);
assert.strictEqual(mergeIncomingOrder(live, stub).total_amount, 525.08);
assert.strictEqual(mergeIncomingOrder(stub, live).customer_name, 'Sam');
assert.strictEqual(mergeIncomingOrder(live, stub).customer_name, 'Sam');
assert.deepStrictEqual(popupDecisionActions(live).map((a) => a.label), ['Accept', 'Reject']);
assert.strictEqual(popupDecisionActions(live).filter((a) => a.label === 'Accept').length, 1);
assert.strictEqual(popupDecisionActions({ status: 'prescription_review', order_type: 'prescription' }).filter((a) => a.label === 'Accept').length, 1);

const src = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
const helpers = fs.readFileSync(path.join(__dirname, 'orderPopup.ts'), 'utf8');
const push = fs.readFileSync(path.join(__dirname, 'sellerPush.ts'), 'utf8');
assert.ok(src.includes('Bill loading'));
assert.ok(src.includes('popupDecisionActions(order)'));
assert.ok(src.includes("label=\"View\""));
assert.ok(src.includes('mergeIncomingOrder'));
assert.ok(helpers.includes('customer_payable'));
assert.ok(push.includes('customer_payable'));
assert.ok(!src.includes('{fresh ? <FreshBanner'));

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.json'), 'utf8'));
assert.strictEqual(pkg.version, '1.0.10');
assert.strictEqual(app.expo.version, '1.0.10');
assert.strictEqual(app.expo.android.versionCode, 11);

console.log('orderPopup 1.0.10 bill merge + single Accept ok');
