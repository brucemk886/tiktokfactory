export const SMART_OPENING_STYLE_ID = "smart-strongest";

export const OPENING_STYLES = Object.freeze([
  Object.freeze({
    id: SMART_OPENING_STYLE_ID,
    label: "智能最强钩子",
    recommended: true,
    hook: "第一句前先找出原文里的最大背叛、异常、身份反差和主角底牌，再组合成最强三拍反转。",
    firstLine: "第一句砸出原文中最严重且已经确认的事实；第二句写对方的错误预期或直接后果；第三句用主角的反常反应或真实底牌留下信息缺口。例：My fiancé drugged me and handed me to a mob boss. He thought I was terrified. I whispered, ‘Finally home.’",
    threeBeat: "事实炸点 → 错误预期或后果 → 反常反应或隐藏底牌"
  }),
  Object.freeze({
    id: "evidence-slam",
    label: "铁证砸脸",
    hook: "第一句直接亮出戒指、短信、录音、DNA 或转账等原文已经存在的具体证据。",
    firstLine: "第一句必须包含人物关系 + 看得见的证据 + 证据证明的背叛或谎言，不先解释发现过程。例：My husband's wedding ring was on my sister's nightstand.",
    threeBeat: "具体铁证 → 铁证指向的伤害 → 仍未解释的关键问题"
  }),
  Object.freeze({
    id: "identity-bomb",
    label: "身份炸弹",
    hook: "第一句揭开原文已经确认、足以瞬间改写人物关系或权力位置的身份事实。",
    firstLine: "第一句同时写出旧认知和真实身份，让两者形成不可能共存的反差；原文没有身份反转就不能编造。例：The mob boss they sold me to was the father I thought was dead.",
    threeBeat: "旧身份认知 → 真实身份爆雷 → 新身份将造成的危险"
  }),
  Object.freeze({
    id: "scene-meltdown",
    label: "现场失控",
    hook: "第一句从婚礼、葬礼、宴会或签约等原文已有的公开现场爆雷，让所有人都无法体面收场。",
    firstLine: "第一句必须写清地点、人物和正在发生的不可挽回动作；没有公开场面时，用原文最难收场的现场，不能另编婚礼。例：My fiancé kissed my best friend while I stood at the altar.",
    threeBeat: "公开动作 → 众人或主角的即时后果 → 更大的秘密即将暴露"
  }),
  Object.freeze({
    id: "cornered-counterstrike",
    label: "绝境反杀",
    hook: "第一句让主角落入原文最深的绝境，随后露出对方不知道、但原文确实存在的翻盘底牌。",
    firstLine: "第一句写清谁把主角推入什么绝境；第二句写对方以为自己赢了；第三句只露出足以翻盘的底牌，不提前解释完。例：They sold me to save their company. They forgot I owned its debt.",
    threeBeat: "主角被逼入绝境 → 对方误判胜局 → 主角底牌反杀"
  })
]);

const LEGACY_STYLE_ALIASES = Object.freeze({
  "conflict-first": "evidence-slam",
  "secret-reveal": "identity-bomb",
  "betrayal-caught": "scene-meltdown",
  "forbidden-line": "cornered-counterstrike"
});

export const DEFAULT_OPENING_STYLE_IDS = Object.freeze([SMART_OPENING_STYLE_ID]);

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
  const styles = wanted.map((id) => {
    const canonicalId = LEGACY_STYLE_ALIASES[id] || id;
    return OPENING_STYLES.find((item) => item.id === canonicalId);
  });
  if (styles.some((item) => !item)) {
    const error = new Error("所选风格无效，请重新勾选。");
    error.statusCode = 400;
    throw error;
  }
  return styles;
}

export function formatOpeningStyleBrief(style, index) {
  return `${index + 1}. ${style.id} / ${style.label}：${style.hook}\n   三拍结构：${style.threeBeat}\n   第一句做法：${style.firstLine}`;
}

export function publicOpeningStyles() {
  return OPENING_STYLES.map((item) => ({
    id: item.id,
    label: item.label,
    hook: item.hook,
    recommended: item.recommended === true,
    example: String(item.firstLine || "").split("例：")[1] || ""
  }));
}
