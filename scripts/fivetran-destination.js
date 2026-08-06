import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DEFAULT_PORT = 5432;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CONNECTION_TIMEOUT_MS = 15_000;
const STATEMENT_TIMEOUT_MS = 20_000;

export function createFivetranDestinationService({
  workDir,
  PoolClass = pg.Pool,
  now = () => Date.now()
} = {}) {
  if (!workDir) throw new Error("Fivetran destination service requires a work directory.");

  const settingsPath = path.join(workDir, "fivetran-destination-settings.json");
  fs.mkdirSync(workDir, { recursive: true });

  function getPublicSettings() {
    const settings = readSettings();
    return {
      configured: Boolean(settings.host && settings.database && settings.user && settings.password),
      host: settings.host || "",
      port: Number(settings.port || DEFAULT_PORT),
      database: settings.database || "",
      user: settings.user || "",
      hasPassword: Boolean(settings.password),
      ssl: settings.ssl !== false,
      updatedAt: Number(settings.updatedAt || 0)
    };
  }

  function saveSettings(payload = {}) {
    const current = readSettings();
    const next = {
      host: clean(payload.host ?? current.host),
      port: normalizePort(payload.port ?? current.port),
      database: clean(payload.database ?? current.database),
      user: clean(payload.user ?? current.user),
      password: clean(payload.password) || current.password || "",
      ssl: payload.ssl === undefined ? current.ssl !== false : payload.ssl !== false,
      updatedAt: now()
    };
    validateSettings(next);
    writeJson(settingsPath, next);
    return getPublicSettings();
  }

  async function testConnection() {
    return withReadOnlyClient(async (client) => {
      const result = await client.query(`
        select current_database() as database,
               current_user as role,
               current_timestamp as checked_at
      `);
      return {
        connected: true,
        database: clean(result.rows[0]?.database),
        role: clean(result.rows[0]?.role),
        checkedAt: parseTime(result.rows[0]?.checked_at) || now()
      };
    });
  }

  async function discover() {
    return withReadOnlyClient(async (client) => {
      const schemas = await listTikTokSchemas(client, { includeCounts: true });
      return { connected: true, schemas };
    });
  }

  async function listAccounts() {
    return withReadOnlyClient(async (client) => {
      const schemas = await listTikTokSchemas(client);
      const accounts = [];
      for (const schema of schemas) {
        const tableNames = new Set(schema.tables.map((item) => item.name));
        if (!tableNames.has("profile")) continue;
        const profileResult = await client.query(`
          select username, display_name, profile_image, profile_deep_link,
                 is_business_account, following_count, followers_count,
                 videos_count, total_likes, is_verified, _fivetran_synced
          from ${quoteIdentifier(schema.name)}."profile"
          where coalesce(_fivetran_deleted, false) = false
          order by _fivetran_synced desc nulls last
          limit 1
        `);
        const profile = profileResult.rows[0] ? normalizeProfile(profileResult.rows[0]) : null;
        const syncedVideoCount = tableNames.has("video")
          ? Number((await client.query(`
              select count(*)::int as count
              from ${quoteIdentifier(schema.name)}."video"
              where coalesce(_fivetran_deleted, false) = false
            `)).rows[0]?.count || 0)
          : 0;
        accounts.push({
          schema: schema.name,
          label: profile?.username ? `@${profile.username}` : profile?.displayName || schema.name,
          profile,
          syncedVideoCount,
          latestSyncAt: profile?.syncedAt || 0
        });
      }
      return { connected: true, accounts };
    });
  }

  async function listVideos({ schema, query = "", limit = DEFAULT_LIMIT } = {}) {
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || DEFAULT_LIMIT)));
    const search = clean(query).slice(0, 240);
    return withReadOnlyClient(async (client) => {
      const selected = await resolveSchema(client, schema, "video");
      const result = await client.query(`
        select id::text as id, caption, thumbnail_url, share_url, embed_url,
               create_time, video_duration, video_views, reach, likes, comments,
               shares, favorites, profile_views, new_followers,
               average_time_watched, full_video_watched_rate, total_time_watched,
               _fivetran_synced
        from ${quoteIdentifier(selected.name)}."video"
        where coalesce(_fivetran_deleted, false) = false
          and ($2 = '' or id::text like $2 || '%' or caption ilike '%' || $2 || '%')
        order by create_time desc nulls last, _fivetran_synced desc nulls last
        limit $1
      `, [safeLimit, search]);
      return {
        connected: true,
        schema: selected.name,
        query: search,
        videos: result.rows.map(normalizeVideo)
      };
    });
  }

  async function getVideoDetail({ schema, videoId } = {}) {
    const id = clean(videoId);
    if (!/^\d{5,30}$/.test(id)) throw httpError(400, "Please enter a valid numeric TikTok video ID.");
    return withReadOnlyClient(async (client) => {
      const selected = await resolveSchema(client, schema, "video");
      const tableNames = new Set(selected.tables.map((item) => item.name));
      const videoResult = await client.query(`
        select id::text as id, caption, thumbnail_url, share_url, embed_url,
               create_time, video_duration, video_views, reach, likes, comments,
               shares, favorites, profile_views, new_followers,
               average_time_watched, full_video_watched_rate, total_time_watched,
               _fivetran_synced
        from ${quoteIdentifier(selected.name)}."video"
        where coalesce(_fivetran_deleted, false) = false and id = $1::bigint
        limit 1
      `, [id]);
      if (!videoResult.rows[0]) throw httpError(404, "This video ID was not found in the selected synchronized account.");

      const profileResult = tableNames.has("profile")
        ? await client.query(`
            select username, display_name, profile_image, profile_deep_link,
                   is_business_account, following_count, followers_count,
                   videos_count, total_likes, is_verified, _fivetran_synced
            from ${quoteIdentifier(selected.name)}."profile"
            where coalesce(_fivetran_deleted, false) = false
            order by _fivetran_synced desc nulls last
            limit 1
          `)
        : { rows: [] };
      const details = new Map([[id, {
        retention: [], engagementLikes: [], impressionSources: [], audienceGender: [],
        audienceCountry: [], audienceCity: [], audienceType: []
      }]]);
      await fillDetail(client, selected.name, tableNames, "video_view_retention", [id], "retention", ["second", "percentage"], details, "second asc");
      await fillDetail(client, selected.name, tableNames, "video_engagement_like", [id], "engagementLikes", ["second", "percentage"], details, "second asc");
      await fillDetail(client, selected.name, tableNames, "video_impression_source", [id], "impressionSources", ["impression_source", "percentage"], details);
      await fillDetail(client, selected.name, tableNames, "video_audience_gender", [id], "audienceGender", ["gender", "percentage"], details);
      await fillDetail(client, selected.name, tableNames, "video_audience_country", [id], "audienceCountry", ["country", "percentage"], details);
      await fillDetail(client, selected.name, tableNames, "video_audience_city", [id], "audienceCity", ["city_name", "percentage"], details);
      await fillDetail(client, selected.name, tableNames, "video_audience_type", [id], "audienceType", ["type", "percentage"], details);

      const comments = tableNames.has("comment")
        ? (await client.query(`
            select id::text as id, username, unique_identifier, display_name,
                   text, likes, replies, pinned, liked, owner, status, create_time,
                   profile_image, _fivetran_synced
            from ${quoteIdentifier(selected.name)}."comment"
            where coalesce(_fivetran_deleted, false) = false and video_id = $1::bigint
            order by likes desc nulls last, create_time desc nulls last
            limit 100
          `, [id])).rows.map(normalizeComment)
        : [];

      return {
        connected: true,
        schema: selected.name,
        profile: profileResult.rows[0] ? normalizeProfile(profileResult.rows[0]) : null,
        video: { ...normalizeVideo(videoResult.rows[0]), ...details.get(id) },
        comments
      };
    });
  }

  async function getSnapshot({ schema, limit = DEFAULT_LIMIT } = {}) {
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || DEFAULT_LIMIT)));
    const discovery = await discover();
    const selected = discovery.schemas.find((item) => item.name === clean(schema)) || discovery.schemas[0];
    if (!selected) throw httpError(404, "No synchronized TikTok Organic schema was found.");
    const schemaName = selected.name;
    const tableNames = new Set(selected.tables.map((item) => item.name));

    return withReadOnlyClient(async (client) => {
      const profiles = tableNames.has("profile")
        ? (await client.query(`
            select username, display_name, profile_image, profile_deep_link,
                   is_business_account, following_count, followers_count,
                   videos_count, total_likes, is_verified, _fivetran_synced
            from ${quoteIdentifier(schemaName)}."profile"
            where coalesce(_fivetran_deleted, false) = false
            order by _fivetran_synced desc nulls last
            limit $1
          `, [safeLimit])).rows
        : [];

      const videos = tableNames.has("video")
        ? (await client.query(`
            select id::text as id, caption, thumbnail_url, share_url, embed_url,
                   create_time, video_duration, video_views, reach, likes, comments,
                   shares, favorites, profile_views, new_followers,
                   average_time_watched, full_video_watched_rate, total_time_watched,
                   _fivetran_synced
            from ${quoteIdentifier(schemaName)}."video"
            where coalesce(_fivetran_deleted, false) = false
            order by create_time desc nulls last, _fivetran_synced desc nulls last
            limit $1
          `, [safeLimit])).rows
        : [];

      const videoIds = videos.map((item) => String(item.id)).filter(Boolean);
      const details = new Map(videoIds.map((id) => [id, { impressionSources: [], audienceGender: [], audienceCountry: [], retention: [] }]));
      if (videoIds.length) {
        await fillDetail(client, schemaName, tableNames, "video_impression_source", videoIds, "impressionSources", ["impression_source", "percentage"], details);
        await fillDetail(client, schemaName, tableNames, "video_audience_gender", videoIds, "audienceGender", ["gender", "percentage"], details);
        await fillDetail(client, schemaName, tableNames, "video_audience_country", videoIds, "audienceCountry", ["country", "percentage"], details);
        await fillDetail(client, schemaName, tableNames, "video_view_retention", videoIds, "retention", ["second", "percentage"], details, "second asc");
      }

      const latestSyncAt = Math.max(
        0,
        ...profiles.map((item) => parseTime(item._fivetran_synced)),
        ...videos.map((item) => parseTime(item._fivetran_synced))
      );

      return {
        connected: true,
        schema: schemaName,
        latestSyncAt,
        counts: Object.fromEntries(selected.tables.map((item) => [item.name, item.count])),
        profiles: profiles.map(normalizeProfile),
        videos: videos.map((item) => ({ ...normalizeVideo(item), ...details.get(String(item.id)) }))
      };
    });
  }

  async function getOperationSignals({ accountNames = [], days = 10, videosPerAccount = 30, publishedAfter = 0 } = {}) {
    const requestedAccounts = new Set((accountNames || []).map(normalizeAccountName).filter(Boolean));
    const safeDays = Math.max(1, Math.min(30, Math.floor(Number(days) || 10)));
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(videosPerAccount) || 30)));
    const cutoffAt = Math.max(
      now() - safeDays * 24 * 60 * 60 * 1_000,
      Number(publishedAfter) || 0
    );

    return withReadOnlyClient(async (client) => {
      const schemas = await listTikTokSchemas(client);
      const accountSignals = [];
      for (const schema of schemas) {
        const tableNames = new Set(schema.tables.map((item) => item.name));
        if (!tableNames.has("profile") || !tableNames.has("video")) continue;
        const profileRow = (await client.query(`
          select username, display_name, profile_image, profile_deep_link,
                 is_business_account, following_count, followers_count,
                 videos_count, total_likes, is_verified, _fivetran_synced
          from ${quoteIdentifier(schema.name)}."profile"
          where coalesce(_fivetran_deleted, false) = false
          order by _fivetran_synced desc nulls last
          limit 1
        `)).rows[0];
        const profile = profileRow ? normalizeProfile(profileRow) : null;
        const username = normalizeAccountName(profile?.username);
        if (!username || (requestedAccounts.size && !requestedAccounts.has(username))) continue;

        const rows = (await client.query(`
          select id::text as id, caption, thumbnail_url, share_url, embed_url,
                 create_time, video_duration, video_views, reach, likes, comments,
                 shares, favorites, profile_views, new_followers,
                 average_time_watched, full_video_watched_rate, total_time_watched,
                 _fivetran_synced
          from ${quoteIdentifier(schema.name)}."video"
          where coalesce(_fivetran_deleted, false) = false
          order by create_time desc nulls last, _fivetran_synced desc nulls last
          limit $1
        `, [safeLimit])).rows;
        const recentRows = rows.filter((row) => {
          const createdAt = normalizeTikTokTime(row.create_time);
          return !createdAt || createdAt >= cutoffAt;
        });
        const videoIds = recentRows.map((item) => String(item.id)).filter(Boolean);
        const details = new Map(videoIds.map((id) => [id, {
          retention: [],
          engagementLikes: [],
          impressionSources: [],
          audienceGender: [],
          audienceCountry: [],
          audienceCity: [],
          audienceType: []
        }]));
        if (videoIds.length) {
          await fillDetail(client, schema.name, tableNames, "video_view_retention", videoIds, "retention", ["second", "percentage"], details, "second asc");
          await fillDetail(client, schema.name, tableNames, "video_engagement_like", videoIds, "engagementLikes", ["second", "percentage"], details, "second asc");
          await fillDetail(client, schema.name, tableNames, "video_impression_source", videoIds, "impressionSources", ["impression_source", "percentage"], details);
          await fillDetail(client, schema.name, tableNames, "video_audience_gender", videoIds, "audienceGender", ["gender", "percentage"], details);
          await fillDetail(client, schema.name, tableNames, "video_audience_country", videoIds, "audienceCountry", ["country", "percentage"], details);
          await fillDetail(client, schema.name, tableNames, "video_audience_city", videoIds, "audienceCity", ["city_name", "percentage"], details);
          await fillDetail(client, schema.name, tableNames, "video_audience_type", videoIds, "audienceType", ["type", "percentage"], details);
        }
        accountSignals.push({
          schema: schema.name,
          username,
          profile,
          videos: recentRows.map((row) => ({ ...normalizeVideo(row), ...details.get(String(row.id)) }))
        });
      }

      return summarizeOperationSignals(accountSignals, {
        days: safeDays,
        requestedAccountCount: requestedAccounts.size,
        generatedAt: now()
      });
    });
  }

  async function withReadOnlyClient(callback) {
    const settings = readSettings();
    validateSettings(settings);
    const pool = new PoolClass(createPoolConfig(settings));
    let client;
    try {
      client = await pool.connect();
      await client.query("begin read only");
      await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      const value = await callback(client);
      await client.query("commit");
      return value;
    } catch (error) {
      if (client) await client.query("rollback").catch(() => {});
      throw normalizeDatabaseError(error);
    } finally {
      client?.release?.();
      await pool.end?.().catch(() => {});
    }
  }

  function readSettings() {
    return {
      host: clean(process.env.FIVETRAN_DB_HOST),
      port: normalizePort(process.env.FIVETRAN_DB_PORT || DEFAULT_PORT),
      database: clean(process.env.FIVETRAN_DB_NAME),
      user: clean(process.env.FIVETRAN_DB_USER),
      password: clean(process.env.FIVETRAN_DB_PASSWORD),
      ssl: process.env.FIVETRAN_DB_SSL === "false" ? false : true,
      ...readJson(settingsPath, {})
    };
  }

  return {
    getPublicSettings,
    saveSettings,
    testConnection,
    discover,
    getSnapshot,
    listAccounts,
    listVideos,
    getVideoDetail,
    getOperationSignals
  };
}

export function summarizeOperationSignals(accountSignals = [], options = {}) {
  const accounts = (accountSignals || []).map((account) => {
    const videos = (account.videos || []).map((video) => buildPrivateVideoSignal(video, account));
    return {
      schema: clean(account.schema),
      username: normalizeAccountName(account.username || account.profile?.username),
      videoCount: videos.length,
      ...aggregatePrivateVideos(videos),
      videos: videos.sort((left, right) => right.views - left.views).slice(0, 30)
    };
  }).filter((account) => account.username);
  const allVideos = accounts.flatMap((account) => account.videos);
  return {
    connected: true,
    status: allVideos.length ? "ready" : "empty",
    windowDays: Math.max(1, Number(options.days) || 10),
    requestedAccountCount: Math.max(0, Number(options.requestedAccountCount) || 0),
    matchedAccountCount: accounts.length,
    generatedAt: Number(options.generatedAt) || Date.now(),
    summary: aggregatePrivateVideos(allVideos),
    accounts
  };
}

function buildPrivateVideoSignal(video = {}, account = {}) {
  const duration = Math.max(0, Number(video.duration) || 0);
  const retention = normalizeCurve(video.retention, "second");
  const likeCurve = normalizeCurve(video.engagementLikes, "second");
  const retentionAt3 = curveValueAt(retention, 3);
  const retentionAt5 = curveValueAt(retention, 5);
  const retentionAt10 = curveValueAt(retention, 10);
  const retentionAt25 = duration ? curveValueAt(retention, duration * 0.25) : null;
  const retentionAt50 = duration ? curveValueAt(retention, duration * 0.5) : null;
  const retentionAt75 = duration ? curveValueAt(retention, duration * 0.75) : null;
  const retentionAtEnd = duration ? curveValueAt(retention, Math.max(0, duration - 1)) : null;
  const averageWatchRatio = duration > 0 ? ratio(Number(video.averageTimeWatched) / duration) : null;
  const fullWatchRate = optionalRatio(video.fullWatchRate);
  const sources = new Map((video.impressionSources || []).map((item) => [
    clean(item.impressionSource).toLowerCase(),
    optionalRatio(item.percentage)
  ]));
  const largestDrop = largestCurveDrop(retention);
  const views = Math.max(0, Number(video.views) || 0);
  const diagnosticEngagementRate = views > 0
    ? ratio(((Number(video.likes) || 0) + (Number(video.comments) || 0) + (Number(video.shares) || 0)) / views)
    : 0;
  let conflict = "";
  if (views >= 1_000 && ((retentionAt3 !== null && retentionAt3 < 0.45) || (averageWatchRatio !== null && averageWatchRatio < 0.25))) {
    conflict = "high_distribution_weak_retention";
  } else if (views <= 200 && retentionAt3 !== null && retentionAt3 >= 0.65 && averageWatchRatio !== null && averageWatchRatio >= 0.35) {
    conflict = "low_distribution_strong_retention";
  }
  return {
    schema: clean(account.schema),
    username: normalizeAccountName(account.username || account.profile?.username),
    videoId: clean(video.id),
    caption: clean(video.caption).slice(0, 500),
    createdAt: Number(video.createdAt) || 0,
    duration,
    views,
    reach: Math.max(0, Number(video.reach) || 0),
    likes: Math.max(0, Number(video.likes) || 0),
    comments: Math.max(0, Number(video.comments) || 0),
    shares: Math.max(0, Number(video.shares) || 0),
    favorites: Math.max(0, Number(video.favorites) || 0),
    profileViews: Math.max(0, Number(video.profileViews) || 0),
    newFollowers: Math.max(0, Number(video.newFollowers) || 0),
    averageTimeWatched: Math.max(0, Number(video.averageTimeWatched) || 0),
    totalTimeWatched: Math.max(0, Number(video.totalTimeWatched) || 0),
    averageWatchRatio,
    fullWatchRate,
    retentionAt3,
    retentionAt5,
    retentionAt10,
    retentionAt25,
    retentionAt50,
    retentionAt75,
    retentionAtEnd,
    largestRetentionDrop: largestDrop.value,
    largestRetentionDropSecond: largestDrop.second,
    forYouRate: findSourceRate(sources, ["for you", "foryou", "for_you"]),
    searchRate: findSourceRate(sources, ["search"]),
    profileRate: findSourceRate(sources, ["personal profile", "profile"]),
    diagnosticEngagementRate,
    conflict,
    retentionCurve: retention.map((point) => ({ second: point.second, percentage: point.value })),
    likeCurve: likeCurve.map((point) => ({ second: point.second, percentage: point.value })),
    impressionSources: normalizeBreakdown(video.impressionSources, "impressionSource"),
    audienceGender: normalizeBreakdown(video.audienceGender, "gender"),
    audienceCountry: normalizeBreakdown(video.audienceCountry, "country"),
    audienceCity: normalizeBreakdown(video.audienceCity, "cityName"),
    audienceType: normalizeBreakdown(video.audienceType, "type")
  };
}

function normalizeBreakdown(items, labelKey) {
  return (items || []).map((item) => ({
    label: clean(item?.[labelKey]),
    percentage: optionalRatio(item?.percentage)
  })).filter((item) => item.label && item.percentage !== null);
}

function aggregatePrivateVideos(videos = []) {
  const values = (videos || []).filter(Boolean);
  const average = (key) => optionalMean(values.map((item) => item[key]));
  const maxViews = values.reduce((max, item) => Math.max(max, Number(item.views) || 0), 0);
  return {
    detailedVideoCount: values.length,
    maxViews,
    averageViews: roundMetric(optionalMean(values.map((item) => item.views))),
    averageWatchRatio: roundMetric(average("averageWatchRatio")),
    averageFullWatchRate: roundMetric(average("fullWatchRate")),
    averageRetention3: roundMetric(average("retentionAt3")),
    averageRetention5: roundMetric(average("retentionAt5")),
    averageRetention10: roundMetric(average("retentionAt10")),
    averageRetention25: roundMetric(average("retentionAt25")),
    averageRetention50: roundMetric(average("retentionAt50")),
    averageRetention75: roundMetric(average("retentionAt75")),
    averageRetentionEnd: roundMetric(average("retentionAtEnd")),
    averageForYouRate: roundMetric(average("forYouRate")),
    averageSearchRate: roundMetric(average("searchRate")),
    conflictCount: values.filter((item) => item.conflict).length,
    highDistributionWeakRetentionCount: values.filter((item) => item.conflict === "high_distribution_weak_retention").length,
    lowDistributionStrongRetentionCount: values.filter((item) => item.conflict === "low_distribution_strong_retention").length
  };
}

function normalizeCurve(items, secondKey) {
  return (items || []).map((item) => ({
    second: Math.max(0, Number(item?.[secondKey]) || 0),
    value: optionalRatio(item?.percentage)
  })).filter((item) => item.value !== null).sort((left, right) => left.second - right.second);
}

function curveValueAt(curve, targetSecond) {
  if (!curve.length) return null;
  let nearest = curve[0];
  for (const point of curve) {
    if (Math.abs(point.second - targetSecond) < Math.abs(nearest.second - targetSecond)) nearest = point;
  }
  return nearest.value;
}

function largestCurveDrop(curve) {
  let value = 0;
  let second = 0;
  for (let index = 1; index < curve.length; index += 1) {
    const drop = curve[index - 1].value - curve[index].value;
    if (drop > value) {
      value = drop;
      second = curve[index].second;
    }
  }
  return { value: roundMetric(value), second };
}

function findSourceRate(sources, names) {
  for (const name of names) {
    if (sources.has(name)) return sources.get(name);
  }
  return null;
}

function optionalRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return ratio(numeric > 1 ? numeric / 100 : numeric);
}

function ratio(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function optionalMean(values) {
  const numbers = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function roundMetric(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 10_000) / 10_000;
}

function normalizeAccountName(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

async function listTikTokSchemas(client, { includeCounts = false } = {}) {
  const result = await client.query(`
    select c.table_schema, c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where t.table_type = 'BASE TABLE'
      and c.table_schema not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'pgbouncer')
      and c.table_schema not like 'pg_%'
    order by c.table_schema, c.table_name, c.ordinal_position
  `);
  const schemas = [];
  for (const [schemaName, tables] of groupMetadata(result.rows)) {
    if (!isTikTokSchema(schemaName, tables)) continue;
    const tableSummaries = [];
    for (const [tableName, columns] of tables) {
      let count = 0;
      if (includeCounts) {
        const countResult = await client.query(`select count(*)::int as count from ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`);
        count = Number(countResult.rows[0]?.count || 0);
      }
      tableSummaries.push({
        name: tableName,
        count,
        columns: columns.map((column) => ({ name: column.column_name, type: column.data_type }))
      });
    }
    schemas.push({
      name: schemaName,
      profileCount: tableSummaries.find((item) => item.name === "profile")?.count || 0,
      videoCount: tableSummaries.find((item) => item.name === "video")?.count || 0,
      tables: tableSummaries
    });
  }
  return schemas;
}

async function resolveSchema(client, requestedSchema, requiredTable) {
  const schemas = await listTikTokSchemas(client);
  const requested = clean(requestedSchema);
  const selected = schemas.find((item) => item.name === requested) || (!requested ? schemas[0] : null);
  if (!selected) throw httpError(404, "The selected synchronized TikTok account schema was not found.");
  if (requiredTable && !selected.tables.some((item) => item.name === requiredTable)) {
    throw httpError(404, `The selected schema does not contain the ${requiredTable} table.`);
  }
  return selected;
}

async function fillDetail(client, schema, tableNames, table, videoIds, target, columns, details, orderBy = '"index" asc') {
  if (!tableNames.has(table)) return;
  const selectedColumns = columns.map(quoteIdentifier).join(", ");
  const result = await client.query(`
    select video_id::text as video_id, ${selectedColumns}
    from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
    where coalesce(_fivetran_deleted, false) = false
      and video_id = any($1::bigint[])
    order by video_id, ${orderBy}
  `, [videoIds]);
  for (const row of result.rows) {
    const detail = details.get(String(row.video_id));
    if (!detail) continue;
    const value = {};
    for (const column of columns) value[toCamelCase(column)] = normalizeNumber(row[column], row[column]);
    detail[target].push(value);
  }
}

function createPoolConfig(settings) {
  return {
    host: settings.host,
    port: Number(settings.port || DEFAULT_PORT),
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl: settings.ssl === false ? false : { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
    application_name: "local_factory_fivetran_reader"
  };
}

function validateSettings(settings) {
  if (!settings.host || !settings.database || !settings.user || !settings.password) {
    throw httpError(400, "Please configure the Fivetran destination host, database, user, and password first.");
  }
}

function normalizeProfile(row = {}) {
  return {
    username: clean(row.username),
    displayName: clean(row.display_name),
    profileImage: clean(row.profile_image),
    profileUrl: clean(row.profile_deep_link),
    businessAccount: row.is_business_account === true,
    following: normalizeNumber(row.following_count),
    followers: normalizeNumber(row.followers_count),
    videos: normalizeNumber(row.videos_count),
    totalLikes: normalizeNumber(row.total_likes),
    verified: row.is_verified === true,
    syncedAt: parseTime(row._fivetran_synced)
  };
}

function normalizeVideo(row = {}) {
  return {
    id: clean(row.id),
    caption: clean(row.caption),
    thumbnailUrl: clean(row.thumbnail_url),
    shareUrl: clean(row.share_url),
    embedUrl: clean(row.embed_url),
    createdAt: normalizeTikTokTime(row.create_time),
    duration: normalizeNumber(row.video_duration),
    views: normalizeNumber(row.video_views),
    reach: normalizeNumber(row.reach),
    likes: normalizeNumber(row.likes),
    comments: normalizeNumber(row.comments),
    shares: normalizeNumber(row.shares),
    favorites: normalizeNumber(row.favorites),
    profileViews: normalizeNumber(row.profile_views),
    newFollowers: normalizeNumber(row.new_followers),
    averageTimeWatched: normalizeNumber(row.average_time_watched),
    fullWatchRate: normalizeNumber(row.full_video_watched_rate),
    totalTimeWatched: normalizeNumber(row.total_time_watched),
    syncedAt: parseTime(row._fivetran_synced)
  };
}

function normalizeComment(row = {}) {
  return {
    id: clean(row.id),
    username: clean(row.username),
    uniqueIdentifier: clean(row.unique_identifier),
    displayName: clean(row.display_name),
    text: clean(row.text),
    likes: normalizeNumber(row.likes),
    replies: normalizeNumber(row.replies),
    pinned: row.pinned === true,
    liked: row.liked === true,
    owner: row.owner === true,
    status: clean(row.status),
    profileImage: clean(row.profile_image),
    createdAt: normalizeTikTokTime(row.create_time),
    syncedAt: parseTime(row._fivetran_synced)
  };
}

function groupMetadata(rows) {
  const schemas = new Map();
  for (const row of rows) {
    const schema = clean(row.table_schema);
    const table = clean(row.table_name);
    if (!schemas.has(schema)) schemas.set(schema, new Map());
    if (!schemas.get(schema).has(table)) schemas.get(schema).set(table, []);
    schemas.get(schema).get(table).push(row);
  }
  return schemas;
}

function isTikTokSchema(name, tables) {
  return name.toLowerCase().includes("tiktok") || (tables.has("profile") && tables.has("video"));
}

function quoteIdentifier(value) {
  const identifier = clean(value);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) throw httpError(400, "Invalid database identifier.");
  return `"${identifier}"`;
}

function normalizePort(value) {
  const port = Math.floor(Number(value) || DEFAULT_PORT);
  if (port < 1 || port > 65_535) throw httpError(400, "Invalid PostgreSQL port.");
  return port;
}

function normalizeTikTokTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return parseTime(value);
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDatabaseError(error) {
  if (error?.statusCode) return error;
  const code = clean(error?.code);
  const safeMessages = {
    "28P01": "PostgreSQL authentication failed. Check the database user and password.",
    "3D000": "The configured PostgreSQL database does not exist.",
    "42501": "The database user does not have read permission for the synchronized schema.",
    ENOTFOUND: "The PostgreSQL host could not be resolved.",
    ECONNREFUSED: "The PostgreSQL server refused the connection.",
    ETIMEDOUT: "The PostgreSQL connection timed out.",
    SELF_SIGNED_CERT_IN_CHAIN: "The PostgreSQL TLS certificate could not be verified."
  };
  return httpError(502, safeMessages[code] || `PostgreSQL read failed${code ? ` (${code})` : ""}.`);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clean(value) {
  return String(value ?? "").trim();
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
