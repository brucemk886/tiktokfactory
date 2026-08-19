export function buildFactoryStorageReport({
  sampledAt = Date.now(),
  d1Bytes = 0,
  accounts = 0,
  videos = 0,
  leftoverVideos = 0,
  assignments = 0,
  jobs = 0,
  novels = 0,
  reports = 0,
  r2Bytes = 0,
  r2Objects = 0,
} = {}) {
  const d1Rows = Number(accounts) + Number(leftoverVideos) + Number(assignments) + Number(jobs) + Number(novels) + Number(reports);
  return {
    project: "factory",
    name: "工厂",
    host: "factory.tiktokaitool.com",
    sampledAt: Number(sampledAt) || Date.now(),
    d1: {
      name: "factory-prod",
      bytes: Number(d1Bytes) || 0,
      rows: d1Rows,
    },
    buckets: [
      {
        name: "factory-archive",
        role: "官方视频归档，一号一个对象",
        bytes: Number(r2Bytes) || 0,
        objects: Number(r2Objects) || 0,
      },
    ],
    inventory: {
      accounts: Number(accounts) || 0,
      videos: Number(videos) || 0,
      leftoverVideos: Number(leftoverVideos) || 0,
      assignments: Number(assignments) || 0,
      jobs: Number(jobs) || 0,
      novels: Number(novels) || 0,
      reports: Number(reports) || 0,
    },
  };
}
