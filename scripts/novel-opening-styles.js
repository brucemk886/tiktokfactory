export const OPENING_STYLES = Object.freeze([
  Object.freeze({
    id: "conflict-first",
    label: "冲突先行",
    hook: "前 3 秒就对质、拆穿或吵架，滑动的人立刻停下来。"
  }),
  Object.freeze({
    id: "secret-reveal",
    label: "秘密揭开",
    hook: "先丢一个不该被知道的秘密，再落到具体事件。"
  }),
  Object.freeze({
    id: "betrayal-caught",
    label: "当场背叛",
    hook: "撞见出轨、婚礼、另一个女人，羞耻和愤怒同时砸下来。"
  }),
  Object.freeze({
    id: "forbidden-line",
    label: "禁忌越界",
    hook: "用一句话钉死不该发生的关系，让观众想看他们怎么收场。"
  }),
  Object.freeze({
    id: "identity-twist",
    label: "身份反转",
    hook: "开头就错位：他不是表面上的那个人，她也不是来做客的。"
  }),
  Object.freeze({
    id: "public-shame",
    label: "当众受辱",
    hook: "宴席、婚礼或公司里被当众打脸，围观本身就是冲突。"
  }),
  Object.freeze({
    id: "deadline-lock",
    label: "时间锁死",
    hook: "今晚、周年、婚礼倒计时，来不及解释，只能先行动。"
  }),
  Object.freeze({
    id: "emotional-immersion",
    label: "情绪代入",
    hook: "第一人称先给身体感受和心跳，再带出事件。"
  }),
  Object.freeze({
    id: "villain-open",
    label: "反派开口",
    hook: "从对方、小三或长辈的嘴开始讲，观众先站错队再被打脸。"
  }),
  Object.freeze({
    id: "ending-flash",
    label: "结局倒叙",
    hook: "先给后果或最后一晚，再跳回这件事是怎么开始的。"
  })
]);

export const DEFAULT_OPENING_STYLE_IDS = Object.freeze([
  "conflict-first",
  "betrayal-caught",
  "secret-reveal"
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

export function publicOpeningStyles() {
  return OPENING_STYLES.map((item) => ({ ...item }));
}
