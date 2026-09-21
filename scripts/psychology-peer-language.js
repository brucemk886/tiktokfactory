const ENGLISH_LANG = new Set(["", "en", "eng", "english", "en-us", "en-gb", "en-au", "en-ca"]);
const VIETNAMESE = /[ăâêôơưđạảãầấậẩẫằắặẳẵẹẻẽềếệểễịỉĩọỏõồốộổỗờớợởỡụủũừứựửữỳỵỷỹ]/i;
const ENGLISH_FUNCTION = new Set("the a an to of and in you is that it for on with this are was be have as i we they he she not but or if your my me at from by about just like what when how can will so do".split(" "));
const NON_ENGLISH_WORDS = new Set(`
yang tidak untuk dengan kalo kamu aku gak nggak banget merujuk kepada bukan jangan hubungi
kadang kangen ngerjain saling berbenah kemelekatan pacaran gamon durhaka menelpon meninggalkan
semasa kanak daripada berlaku kesejahteraan penderaan pengabaian awak tanda orang bilang pantas
dicintai emg kyk gini nanya belum bikin kerasa karna solusinya bertumbuh pribadi panduannya
ngeliat cewe nongkrong pdhl posisinya pulang subuh smpe karena cape ngadepinnya emang
ang mga yung hindi naman talaga pero taong gustong nila pagiging totoongtayo kayo pareho silang
ibang paraan wala meron ano
`.trim().split(/\s+/));

export function psychologyPeerHitSourceText(item = {}) {
  const data = item.videoData && typeof item.videoData === "object" ? item.videoData : {};
  return [item.title, data.copy, data.caption, data.script, data.transcript, data.文案]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n");
}

export function isEnglishPsychologyPeerHit(item = {}) {
  const data = item.videoData && typeof item.videoData === "object" ? item.videoData : {};
  const lang = String(data.language || item.language || "").trim().toLowerCase();
  if (lang && !ENGLISH_LANG.has(lang) && !lang.startsWith("en-")) return false;
  return isEnglishPeerCopy(psychologyPeerHitSourceText(item));
}

export function isEnglishPeerCopy(text) {
  const remaining = stripNonContent(text);
  if (!remaining) return true;
  if (/[\u0E00-\u0E7F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0590-\u05FF\uAC00-\uD7AF]/.test(remaining)) return false;
  if (VIETNAMESE.test(remaining)) return false;
  const cjk = remaining.match(/[\u3400-\u9FFF]/g) || [];
  if (cjk.length >= 6) return false;
  const words = remaining.toLowerCase().replace(/[^a-z'-]+/gi, " ").split(/\s+/).filter((word) => word.length > 1);
  const markers = [...new Set(words.filter((word) => NON_ENGLISH_WORDS.has(word)))];
  if (markers.length >= 2) return false;
  const contentWords = words.filter((word) => word.length > 2);
  const functionWords = words.filter((word) => ENGLISH_FUNCTION.has(word));
  if (markers.length >= 1 && contentWords.length >= 8 && functionWords.length <= 1) return false;
  return true;
}

function stripNonContent(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#[^\s#]+/g, " ")
    .replace(/@[^\s@]+/g, " ")
    .replace(/\s\|\s[\s\S]*$/, " ")
    .replace(/(?:^|\s)\/\s*[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF][\s\S]*$/u, " ")
    .replace(/[\u30B7\u309A\u30FC]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
