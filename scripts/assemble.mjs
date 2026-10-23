// Each app builds itself into dist/<app>/. This adds the landing page that links to them.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('site/index.html', 'dist/index.html');
copyFileSync('site/.nojekyll', 'dist/.nojekyll');
console.log('Assembled dist/');
