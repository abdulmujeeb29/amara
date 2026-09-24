import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const files = {
  'node_modules/mapbox-gl/dist/mapbox-gl.js': 'static/vendor/mapbox-gl.js',
  'node_modules/mapbox-gl/dist/mapbox-gl.css': 'static/vendor/mapbox-gl.css',
  'node_modules/mapbox-gl-compat/dist/mapbox-gl.js': 'static/vendor/mapbox-compat.js',
  'node_modules/gsap/dist/gsap.min.js': 'static/vendor/gsap.min.js',
  'node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2': 'static/build/fonts/dm-sans.woff2',
  'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2': 'static/build/fonts/manrope.woff2',
  'design/preview/raster-map.js': 'static/build/raster-map.js',
  'frontend/icons.svg': 'static/build/icons.svg',
  'frontend/js/app.js': 'static/build/app.js',
  'frontend/js/map.js': 'static/build/map.js',
  'frontend/js/geo.js': 'static/build/geo.js',
  'frontend/js/http.js': 'static/build/http.js',
  'frontend/js/panel.js': 'static/build/panel.js',
  'frontend/js/location.js': 'static/build/location.js',
  'frontend/js/journey.js': 'static/build/journey.js',
  'frontend/js/demo-player.js': 'static/build/demo-player.js',
  'frontend/js/evidence.js': 'static/build/evidence.js',
};
for (const [source, target] of Object.entries(files)) {
  await mkdir(path.dirname(target), {recursive: true});
  await copyFile(source, target);
  if (target.endsWith('.js')) {
    const text = await readFile(target, 'utf8');
    await writeFile(target, text.replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
  }
}
console.log('Bundled Amara scripts, fonts, and map renderers locally.');
