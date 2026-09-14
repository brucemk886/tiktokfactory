import fs from 'node:fs';
import path from 'node:path';
export function outputDay(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function dailyOutputDirectory(root, date = new Date()) {
  return path.join(root, outputDay(date));
}
function outputRoots(root) {
  let legacy = [];
  try { legacy = JSON.parse(fs.readFileSync(path.join(root, '.output-storage.json'), 'utf8')).legacyRoots || []; } catch {}
  return [...new Set([path.resolve(root), ...legacy.filter(value => typeof value === 'string' && path.isAbsolute(value)).map(value => path.resolve(value))])];
}
export function isStoredOutputPath(root, file) {
  try {
    const resolved = fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
    return outputRoots(root).some(base => {
      const actual = fs.existsSync(base) ? fs.realpathSync(base) : path.resolve(base);
      const rel = path.relative(actual, resolved);
      return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
  } catch { return false; }
}
export function resolveStoredOutput(root, fileName) {
  const name = String(fileName || '');
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || path.isAbsolute(name)) throw new Error('无效的成片文件名');
  for (const base of outputRoots(root)) {
    const direct = path.join(base, name);
    if (fs.existsSync(direct) && isStoredOutputPath(root, direct)) return direct;
    let days = [];
    try { days = fs.readdirSync(base, { withFileTypes: true }).filter(item => item.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(item.name)).map(item => item.name).sort().reverse(); } catch {}
    for (const day of days) {
      const file = path.join(base, day, name);
      if (fs.existsSync(file) && isStoredOutputPath(root, file)) return file;
    }
  }
  return path.join(root, name);
}
