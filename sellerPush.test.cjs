const assert = require('assert');

function isStubPushToken(token) {
  const value = String(token || '').trim();
  if (!value) return true;
  if (value.startsWith('android-install:')) return true;
  if (value.startsWith('ExponentPushToken')) return true;
  if (value.startsWith('ExpoPushToken')) return true;
  return false;
}

function nativePushTokenFromDevice(device) {
  if (!device) return '';
  if (typeof device === 'string') return device.trim();
  return String(device.data || '').trim();
}

function orderIdFromNotificationData(data) {
  if (!data) return 0;
  const raw = data.orderId ?? data.order_id ?? data.orderID;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

assert.strictEqual(isStubPushToken(''), true);
assert.strictEqual(isStubPushToken('android-install:abc'), true);
assert.strictEqual(isStubPushToken('ExponentPushToken[test-zepmed]'), true);
assert.strictEqual(isStubPushToken('ExpoPushToken[test]'), true);
assert.strictEqual(isStubPushToken('dXNlcjpGYWtlRmNtVG9rZW4'), false);
assert.strictEqual(nativePushTokenFromDevice({ data: 'real-fcm-token' }), 'real-fcm-token');
assert.strictEqual(orderIdFromNotificationData({ order_id: '2054' }), 2054);
assert.strictEqual(orderIdFromNotificationData({ orderId: 88 }), 88);
assert.strictEqual(orderIdFromNotificationData({}), 0);

function orderIdFromSellerLink(url) {
  if (!url) return 0;
  const match = String(url).match(/order\/(\d+)/i);
  if (!match) return 0;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function sellerDeviceTokenBody(token, unbind = false) {
  return {
    fcm_token: token,
    token,
    platform: 'android',
    device_type: 'android',
    device_name: 'ZepMed Seller Expo',
    ...(unbind ? { unbind: 1 } : {}),
  };
}

assert.strictEqual(orderIdFromSellerLink('zepmedseller://order/2211'), 2211);
assert.strictEqual(orderIdFromSellerLink('https://example.test/nope'), 0);
assert.strictEqual(sellerDeviceTokenBody('abc', true).unbind, 1);
assert.strictEqual(sellerDeviceTokenBody('abc').unbind, undefined);

console.log('sellerPush stubs/FCM helpers ok');
