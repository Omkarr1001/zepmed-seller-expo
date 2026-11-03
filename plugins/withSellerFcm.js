const fs = require('fs');
const path = require('path');
const {
  withAppBuildGradle,
  withProjectBuildGradle,
  withDangerousMod,
  createRunOncePlugin,
} = require('@expo/config-plugins');

function withSellerFcmClasspath(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms:google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        "dependencies {\n        classpath('com.google.gms:google-services:4.4.2')"
      );
    }
    return cfg;
  });
}

function withSellerFcmAppPlugin(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("com.google.gms.google-services")) {
      cfg.modResults.contents += `\napply plugin: 'com.google.gms.google-services'\n`;
    }
    return cfg;
  });
}

function withSellerFcmAssets(config) {
  return withDangerousMod(config, ['android', async (cfg) => {
    const projectRoot = cfg.modRequest.projectRoot;
    const appDir = path.join(cfg.modRequest.platformProjectRoot, 'app');
    const rawDir = path.join(appDir, 'src/main/res/raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const googleSrc = path.join(projectRoot, 'google-services.json');
    if (fs.existsSync(googleSrc)) {
      fs.copyFileSync(googleSrc, path.join(appDir, 'google-services.json'));
    }
    const bellSrc = path.join(projectRoot, 'assets/order_bell.mp3');
    if (fs.existsSync(bellSrc)) {
      fs.copyFileSync(bellSrc, path.join(rawDir, 'order_bell.mp3'));
    }
    const localBell = path.join(projectRoot, 'assets/bell.mp3');
    if (fs.existsSync(localBell)) {
      fs.copyFileSync(localBell, path.join(rawDir, 'bell.mp3'));
    }
    return cfg;
  }]);
}

function withSellerFcm(config) {
  config = withSellerFcmClasspath(config);
  config = withSellerFcmAppPlugin(config);
  config = withSellerFcmAssets(config);
  return config;
}

module.exports = createRunOncePlugin(withSellerFcm, 'withSellerFcm', '1.0.0');
