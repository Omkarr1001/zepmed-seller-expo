const {
  withMainApplication,
  withSettingsGradle,
  withAppBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins');

function withZepMedPrinterSettings(config) {
  return withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes("include ':zepmed-printer'")) return cfg;
    cfg.modResults.contents += `
include ':zepmed-printer'
project(':zepmed-printer').projectDir = new File(rootProject.projectDir, '../modules/zepmed-printer/android')
`;
    return cfg;
  });
}

function withZepMedPrinterAppGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes("implementation project(':zepmed-printer')")) return cfg;
    if (!cfg.modResults.contents.includes('dependencies {')) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /dependencies\s*\{/,
      "dependencies {\n    implementation project(':zepmed-printer')"
    );
    return cfg;
  });
}

function withZepMedPrinterMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('com.zepmed.printer.ZepMedPrinterPackage')) {
      src = src.replace(
        /import com\.facebook\.react\.ReactPackage\n/,
        "import com.facebook.react.ReactPackage\nimport com.zepmed.printer.ZepMedPrinterPackage\n"
      );
    }
    if (!src.includes('ZepMedPrinterPackage()')) {
      src = src.replace(
        /val packages = PackageList\(this\)\.packages\n/,
        "val packages = PackageList(this).packages\n            packages.add(ZepMedPrinterPackage())\n"
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withZepMedPrinter(config) {
  config = withZepMedPrinterSettings(config);
  config = withZepMedPrinterAppGradle(config);
  config = withZepMedPrinterMainApplication(config);
  return config;
}

module.exports = createRunOncePlugin(withZepMedPrinter, 'withZepMedPrinter', '1.0.0');
