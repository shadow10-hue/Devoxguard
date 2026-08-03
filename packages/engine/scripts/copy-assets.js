// tsc only compiles .ts files, so the default rule YAML files need an
// explicit copy step into dist/ for consumers of the published package.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'rules', 'default-rules');
const dest = path.join(__dirname, '..', 'dist', 'rules', 'default-rules');

fs.cpSync(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);
