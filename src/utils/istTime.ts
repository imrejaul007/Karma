// @ts-nocheck
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function startOfDayIST(date: Date = new Date()): Date {
  const istMs = date.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istMs);
  istDate.setUTCHours(0, 0, 0, 0);
  return new Date(istDate.getTime() - IST_OFFSET_MS);
}

export function endOfDayIST(date: Date = new Date()): Date {
  const istMs = date.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istMs);
  istDate.setUTCHours(23, 59, 59, 999);
  return new Date(istDate.getTime() - IST_OFFSET_MS);
}
