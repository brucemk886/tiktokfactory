const BUSINESSES = [
  {
    id: "mid-video",
    href: "/mid-video",
    index: "01",
    mark: "视",
    tone: "video",
    title: "中视频",
    body: "舒尔特、播客等模板在这里生产。发布将走官方 API，GeeLark 只作备用。",
    action: "进入模板工作台"
  },
  {
    id: "novel-promotion",
    href: "/operator/official",
    index: "02",
    mark: "书",
    tone: "novel",
    title: "小说推文",
    body: "给小说库和授权账号后开始自运营。官方 API 是主路径，GeeLark 整套在备用区。",
    action: "进入官方自运营"
  },
  {
    id: "psychology",
    href: "/psychology",
    index: "03",
    mark: "心",
    tone: "psy",
    title: "心理学",
    body: "题目库和视频自动化独立运营，不和小说、中视频混在同一条流水线里。",
    action: "进入心理学自动化"
  }
];

const grid = document.getElementById("businessGrid");
if (grid) {
  grid.innerHTML = BUSINESSES.map((item) => `
    <a class="hub-card tone-${item.tone}" href="${item.href}" data-business="${item.id}">
      <div class="hub-card-top">
        <em>${item.index}</em>
        <i class="hub-card-mark">${item.mark}</i>
      </div>
      <strong>${item.title}</strong>
      <span>${item.body}</span>
      <b>${item.action} →</b>
    </a>
  `).join("");
}
