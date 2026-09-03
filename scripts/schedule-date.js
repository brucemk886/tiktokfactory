// Daily publish caps and the hub's catch-up sync both cut the day in
// Asia/Shanghai. Pin the zone here so a machine whose system clock is set to
// another zone still agrees with the hub about which day a publish belongs to.
export const SCHEDULE_TIME_ZONE = "Asia/Shanghai";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function scheduleDateKey(unixSeconds) {
  const date = new Date((Number(unixSeconds) || 0) * 1000);
  return formatter.format(date);
}
