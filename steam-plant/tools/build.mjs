// Bundles src/*.js modules + src/shell.html into one self-contained HTML file.
// Each local module is wrapped in its own function scope; three.js is loaded from the jsDelivr CDN via an import map.
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => readFileSync(join(root, 'src', p), 'utf8');
const THREE_VER = '0.170.0';
const order = ['steamtables.js', 'steam.js', 'sim.js', 'scene.js', 'audio.js', 'ui.js', 'main.js'];

const hoisted = new Set();
const parts = [];
for (const file of order) {
  const name = '__m_' + file.replace('.js', '');
  let code = src(file);
  const exportsList = [];
  code = code.replace(/^import\s+(.+?)\s+from\s+'([^']+)';\s*$/gm, (m, what, from) => {
    if (!from.startsWith('.')) { hoisted.add(m.trim()); return ''; }
    const mod = '__m_' + from.replace('./', '').replace('.js', '');
    if (what.startsWith('* as ')) return `const ${what.slice(5).trim()} = ${mod};`;
    return `const ${what.replace(/\bas\b/g, ':')} = ${mod};`;
  });
  code = code.replace(/^export\s+((?:async\s+)?(?:function|class|const|let))\s+([A-Za-z_$][\w$]*)/gm, (m, kw, id) => { exportsList.push(id); return `${kw} ${id}`; });
  if (/^export\s/m.test(code)) throw new Error(`Unsupported export form in ${file}`);
  if (/<\/script/i.test(code)) throw new Error(`"</script" found in ${file}`);
  parts.push(`// ---- ${file}\nconst ${name} = (() => {\n${code}\nreturn { ${exportsList.join(', ')} };\n})();`);
}

const importMap = `<script type="importmap">${JSON.stringify({ imports: {
  three: `https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js`,
  'three/addons/': `https://cdn.jsdelivr.net/npm/three@${THREE_VER}/examples/jsm/`,
} })}</script>`;
const script = `${importMap}\n<script type="module">\n${[...hoisted].join('\n')}\n${parts.join('\n\n')}\n</script>`;
const shell = src('shell.html');

// Artifact-style page (host supplies the document skeleton) and a standalone, double-clickable page.
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'steam-plant.html'), `${shell}\n${script}\n`);
writeFileSync(join(root, 'index.html'), `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${shell}\n${script}\n</html>\n`);
console.log('built index.html and dist/steam-plant.html', Math.round(script.length / 1024) + ' KB of script');
