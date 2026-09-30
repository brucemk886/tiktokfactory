// Operating calendar: UTC instants, audience-local dates and rounds.
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
export const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const DAY = 86400000;
const formats = new Map();
export function normalizeTimeZone(value = DEFAULT_TIME_ZONE) {
  const zone = value || DEFAULT_TIME_ZONE;
  if (![DEFAULT_TIME_ZONE, PACIFIC_TIME_ZONE].includes(zone)) throw Object.assign(new RangeError('运营时区必须为北京时间或美国太平洋时间。'), { statusCode: 400 });
  return zone;
}
function formatter(zone) {
  zone = normalizeTimeZone(zone);
  if (!formats.has(zone)) formats.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formats.get(zone);
}
export function zonedParts(ms, zone = DEFAULT_TIME_ZONE) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
export const zonedDate = (ms, zone = DEFAULT_TIME_ZONE) => zonedParts(ms, zone).date;
function dateEpoch(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('运营日期无效。');
  const stamp = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) throw new RangeError('运营日期无效。');
  return stamp;
}
function offsetAt(ms, zone) {
  const p = zonedParts(ms, zone);
  return dateEpoch(p.date) + (p.hour * 3600 + p.minute * 60 + p.second) * 1000 - Math.floor(ms / 1000) * 1000;
}
// Skip nonexistent spring times; repeated autumn times resolve once, earliest.
export function zonedEpoch(date, hour = 0, minute = 0, zone = DEFAULT_TIME_ZONE) {
  zone = normalizeTimeZone(zone);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new RangeError('发布时间无效。');
  const wall = dateEpoch(date) + (hour * 60 + minute) * 60000;
  const offsets = new Set([-DAY, 0, DAY].map(delta => offsetAt(wall + delta, zone)));
  const matches = [...offsets].map(offset => wall - offset).filter(ms => {
    const p = zonedParts(ms, zone);
    return p.date === date && p.hour === hour && p.minute === minute;
  }).sort((a, b) => a - b);
  if (!matches.length) throw new RangeError('此当地时间因夏令时切换而不存在。');
  return matches[0];
}
export function addCalendarDays(date, days) {
  if (!Number.isInteger(days)) throw new RangeError('运营天数必须为整数。');
  return new Date(dateEpoch(date) + days * DAY).toISOString().slice(0, 10);
}
export const startOfDay = (ms, zone = DEFAULT_TIME_ZONE) => zonedEpoch(zonedDate(ms, zone), 0, 0, zone);
export const nextDay = (ms, zone = DEFAULT_TIME_ZONE) => zonedEpoch(addCalendarDays(zonedDate(ms, zone), 1), 0, 0, zone);
export function addZonedDays(ms, days, zone = DEFAULT_TIME_ZONE) {
  const p = zonedParts(ms, zone);
  return zonedEpoch(addCalendarDays(p.date, days), p.hour, p.minute, zone) + p.second * 1000 + ((ms % 1000) + 1000) % 1000;
}
export const calendarDayIndex = (ms, start, zone = DEFAULT_TIME_ZONE) => Math.round((dateEpoch(zonedDate(ms, zone)) - dateEpoch(zonedDate(start, zone))) / DAY);
export function pilotTimeZoneAt(pilot, ms) {
  return normalizeTimeZone(pilot.slots_effective_at && ms >= pilot.slots_effective_at
    ? pilot.pending_schedule_timezone || pilot.schedule_timezone
    : pilot.schedule_timezone);
}
