// `node --test` için: src/ altındaki uzantısız göreli importları (Vite tarzı './date') .ts dosyasına çözer.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]sx?$/.test(specifier)) throw e;
      return next(`${specifier}.ts`, context);
    }
  },
});
