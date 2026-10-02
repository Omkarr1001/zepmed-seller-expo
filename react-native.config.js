module.exports = {
  dependencies: {
    'zepmed-printer': {
      root: __dirname + '/modules/zepmed-printer',
      platforms: {
        android: {
          sourceDir: __dirname + '/modules/zepmed-printer/android',
          packageImportPath: 'import com.zepmed.printer.ZepMedPrinterPackage;',
          packageInstance: 'new ZepMedPrinterPackage()',
        },
      },
    },
  },
};
