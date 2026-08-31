export function planImportedAudioAssignments({ pendingScripts = [], files = [], scriptIds = [] } = {}) {
  const pending = (Array.isArray(pendingScripts) ? pendingScripts : []).filter((script) => {
    return script?.id && !String(script.audioId || script.audio?.id || "").trim();
  });
  const wanted = (Array.isArray(scriptIds) ? scriptIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  const queue = wanted.length
    ? wanted.map((id) => pending.find((script) => script.id === id)).filter(Boolean)
    : pending;
  return (Array.isArray(files) ? files : []).map((file, index) => ({
    file,
    scriptId: queue[index]?.id || "",
    createNew: !queue[index]
  }));
}

export function uploadedAudioScriptText(fileName) {
  const name = String(fileName || "audio.mp3").trim() || "audio.mp3";
  return `Uploaded audio for this novel opening. Source file: ${name}.`;
}

export function isPlaceholderUploadedScript(text) {
  return /^uploaded audio for this novel opening\./i.test(String(text || "").trim());
}

export function needsPeerSpeechTranscript(script = {}) {
  if (String(script.sourceType || "") !== "peer-hit") return false;
  if (script.transcriptStatus === "running") return false;
  if (script.transcriptStatus === "ready" && !isPlaceholderUploadedScript(script.text) && String(script.text || "").trim().length >= 8) {
    return false;
  }
  return isPlaceholderUploadedScript(script.text)
    || script.transcriptStatus === "pending"
    || script.transcriptStatus === "failed"
    || !String(script.text || "").trim();
}

export function uploadedAudioOpeningTitle(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .trim()
    .slice(0, 80);
}

export function isImportedAudioFile(file = {}) {
  const name = String(file.name || "").trim().toLowerCase();
  const type = String(file.type || "").trim().toLowerCase();
  return name.endsWith(".mp3") || type === "audio/mpeg" || type === "audio/mp3";
}
