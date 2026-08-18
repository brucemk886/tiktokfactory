export const OPENING_STYLES = Object.freeze([
  Object.freeze({
    id: "conflict-first",
    label: "冲突先行",
    hook: "第一句就点名对质，把戒指、签名、亲吻这类物证砸在对方脸上。",
    firstLine: "第一句必须是对质句：称呼 + 正在发生的物证。禁止从走进房间、看见人群写起。例：Why is the bride wearing my mother's ring?"
  }),
  Object.freeze({
    id: "secret-reveal",
    label: "秘密揭开",
    hook: "第一句先爆出不该存在的秘密，听完就能复述那件事。",
    firstLine: "第一句直接说破秘密本身（私生子、第二场婚礼、遗嘱、她是他的…），不要先铺“我本来不该知道”。例：The baby in her arms has my husband's last name."
  }),
  Object.freeze({
    id: "betrayal-caught",
    label: "当场背叛",
    hook: "第一句就撞见出轨、婚礼或另一个女人，羞耻当场爆发。",
    firstLine: "第一句必须是目击句：我看见谁在对谁做什么。必须有动作（kiss, unzip, sign, walk down the aisle）。例：I caught them kissing in our wedding suite."
  }),
  Object.freeze({
    id: "forbidden-line",
    label: "禁忌越界",
    hook: "第一句用称呼钉死禁忌关系，让人立刻想看怎么收场。",
    firstLine: "第一句必须带禁忌称呼（uncle, stepson, husband's brother, my son's wife）+ 正在发生的越界。不要空喊“我们不该这样”。例：I am pregnant with my uncle's child."
  })
]);

export const DEFAULT_OPENING_STYLE_IDS = Object.freeze([
  "conflict-first",
  "betrayal-caught",
  "secret-reveal",
  "forbidden-line"
]);

export function resolveOpeningStyles(ids) {
  const wanted = (Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!wanted.length) {
    const error = new Error("请先勾选至少 1 种风格，再生成改版开头。");
    error.statusCode = 400;
    throw error;
  }
  if (wanted.length > 10) {
    const error = new Error("一次最多生成 10 个改版开头。");
    error.statusCode = 400;
    throw error;
  }
  const styles = wanted.map((id) => OPENING_STYLES.find((item) => item.id === id));
  if (styles.some((item) => !item)) {
    const error = new Error("所选风格无效，请重新勾选。");
    error.statusCode = 400;
    throw error;
  }
  return styles;
}

export function formatOpeningStyleBrief(style, index) {
  return `${index + 1}. ${style.id} / ${style.label}：${style.hook}\n   第一句做法：${style.firstLine}`;
}

export function publicOpeningStyles() {
  return OPENING_STYLES.map((item) => ({
    id: item.id,
    label: item.label,
    hook: item.hook,
    example: String(item.firstLine || "").split("例：")[1] || ""
  }));
}
