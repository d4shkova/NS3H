// electron-builder packages whatever is in out/; this makes sure it is current,
// so `npx electron-builder` in CI cannot ship a stale renderer.
const { execSync } = require('node:child_process');

exports.default = async function beforePack() {
  execSync('npm run build', { stdio: 'inherit' });
};
