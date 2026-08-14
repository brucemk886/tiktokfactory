const BUSINESSES = [
  {
    id: "mid-video",
    href: "/mid-video",
    kicker: "业务线 01",
    title: "中视频",
    body: "舒尔特、播客等模板在这里生产。发布将走官方 API，GeeLark 只作备用。",
    action: "进入模板工作台"
  },
  {
    id: "novel-promotion",
    href: "/operator/official",
    kicker: "业务线 02",
    title: "小说推文",
    body: "提供小说库和授权账号后开始自运营。官方 API 是主路径，GeeLark 数据与发布整套保留。",
    action: "进入官方自运营"
  },
  {
    id: "psychology",
    href: "/psychology",
    kicker: "业务线 03",
    title: "心理学",
    body: "题目库和视频自动化独立运营，不和小说、中视频混在同一条流水线里。",
    action: "进入心理学自动化"
  }
];

const grid = document.getElementById("businessGrid");
if (grid) {
  grid.innerHTML = BUSINESSES.map((item) => `
    <a class="hub-card" href="${item.href}" data-business="${item.id}">
      <em>${item.kicker}</em>
      <strong>${item.title}</strong>
      <span>${item.body}</span>
      <b>${item.action} →</b>
    </a>
  `).join("");
}
