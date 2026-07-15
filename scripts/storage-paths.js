import path from "node:path";

export function resolveStorageDirs(root, config = {}) {
  return {
    workDir: resolveStoragePath(root, config.workDir, "work"),
    outputDir: resolveStoragePath(root, config.outputDir, "outputs")
  };
}

export function resolveStoragePath(root, value, fallbackName) {
  const text = String(value || "").trim();
  if (!text) return path.join(root, fallbackName);
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(root, text);
}
