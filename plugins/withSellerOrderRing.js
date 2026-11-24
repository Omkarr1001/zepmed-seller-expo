const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
  createRunOncePlugin,
  AndroidConfig,
} = require('@expo/config-plugins');

const KOTLIN_FILES = [
  'IncomingOrderNotifier.kt',
  'IncomingOrderActivity.kt',
  'IncomingOrderReceiver.kt',
  'SellerFirebaseMessagingService.kt',
  'SellerOrderRingModule.kt',
  'SellerOrderRingPackage.kt',
];

function ensurePermission(manifest, name) {
  const current = manifest.manifest['uses-permission'] || [];
  if (!current.some((item) => item.$?.['android:name'] === name)) {
    current.push({ $: { 'android:name': name } });
  }
  manifest.manifest['uses-permission'] = current;
}

function hasNamed(list, name) {
  return (list || []).some((item) => item.$?.['android:name'] === name);
}

function withSellerOrderRingManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    manifest.manifest.$ = manifest.manifest.$ || {};
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    [
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.WAKE_LOCK',
      'android.permission.VIBRATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.TURN_SCREEN_ON',
      'android.permission.SHOW_WHEN_LOCKED',
    ].forEach((name) => ensurePermission(manifest, name));

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = app.service || [];
    if (!hasNamed(app.service, 'expo.modules.notifications.service.ExpoFirebaseMessagingService')) {
      app.service.push({
        $: {
          'android:name': 'expo.modules.notifications.service.ExpoFirebaseMessagingService',
          'tools:node': 'remove',
        },
      });
    }
    if (!hasNamed(app.service, '.SellerFirebaseMessagingService')) {
      app.service.push({
        $: {
          'android:name': '.SellerFirebaseMessagingService',
          'android:exported': 'false',
        },
        'intent-filter': [{
          $: { 'android:priority': '1000' },
          action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }],
        }],
      });
    }
    app.receiver = app.receiver || [];
    if (!hasNamed(app.receiver, '.IncomingOrderReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.IncomingOrderReceiver', 'android:exported': 'false' },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'com.zepmed.seller.ORDER_OPEN' } },
            { $: { 'android:name': 'com.zepmed.seller.ORDER_SILENCE' } },
          ],
        }],
      });
    }
    app.activity = app.activity || [];
    if (!hasNamed(app.activity, '.IncomingOrderActivity')) {
      app.activity.push({
        $: {
          'android:name': '.IncomingOrderActivity',
          'android:exported': 'false',
          'android:excludeFromRecents': 'true',
          'android:showWhenLocked': 'true',
          'android:turnScreenOn': 'true',
          'android:launchMode': 'singleTop',
          'android:theme': '@android:style/Theme.Black.NoTitleBar.Fullscreen',
        },
      });
    }
    return cfg;
  });
}

function withSellerOrderRingSources(config) {
  return withDangerousMod(config, ['android', async (cfg) => {
    const dest = path.join(
      cfg.modRequest.platformProjectRoot,
      'app/src/main/java/com/zepmed/seller',
    );
    const src = path.join(cfg.modRequest.projectRoot, 'native/order-ring');
    fs.mkdirSync(dest, { recursive: true });
    for (const file of KOTLIN_FILES) {
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
    }
    return cfg;
  }]);
}

function withSellerOrderRingPackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('com.zepmed.seller.SellerOrderRingPackage')) {
      src = src.replace(
        /import com\.facebook\.react\.ReactPackage\n/,
        'import com.facebook.react.ReactPackage\nimport com.zepmed.seller.SellerOrderRingPackage\n'
      );
    }
    if (!src.includes('SellerOrderRingPackage()')) {
      src = src.replace(
        /val packages = PackageList\(this\)\.packages\n/,
        'val packages = PackageList(this).packages\n            packages.add(SellerOrderRingPackage())\n'
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSellerOrderRingGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.firebase:firebase-messaging')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        "dependencies {\n    implementation 'com.google.firebase:firebase-messaging:24.0.1'"
      );
    }
    return cfg;
  });
}

function withSellerOrderRing(config) {
  config = withSellerOrderRingManifest(config);
  config = withSellerOrderRingSources(config);
  config = withSellerOrderRingPackage(config);
  config = withSellerOrderRingGradle(config);
  return config;
}

module.exports = createRunOncePlugin(withSellerOrderRing, 'withSellerOrderRing', '1.0.0');
