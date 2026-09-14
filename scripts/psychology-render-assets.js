import fs from 'node:fs';
import path from 'node:path';

// --public-dir replaces Remotion's default public folder. Every isolated
// PsychologyLandscape render must include the companion's eight static poses.
export function preparePsychologyRenderAssets(root, publicDir) {
  const files = Array.from({length: 8}, (_, index) => `stick-${String(index + 1).padStart(2, '0')}.svg`);
  const source = path.join(root, 'public', 'psychology-poses');
  for (const file of files) {
    if (!fs.existsSync(path.join(source, file))) throw new Error(`心理学合成缺少动画素材：psychology-poses/${file}`);
  }
  const destination = path.join(publicDir, 'psychology-poses');
  fs.mkdirSync(destination, {recursive: true});
  for (const file of files) fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
