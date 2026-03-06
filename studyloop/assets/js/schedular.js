export function isoToday() {
  return new Date().toISOString().slice(0,10);
}

export function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

export function weekdayIndex(isoDate) {
  // Monday=0 ... Sunday=6
  const d = new Date(isoDate + "T00:00:00");
  const js = d.getDay(); // Sun=0
  return (js + 6) % 7;
}

export function parseDaysCSV(s) {
  return (s || "")
    .split(",")
    .map(x => parseInt(x.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a,b) => a - b);
}

export function nextWorkDay(isoDate, holidaySet, weeklyOffSet) {
  let d = isoDate;
  while (holidaySet.has(d) || weeklyOffSet.has(weekdayIndex(d))) {
    d = addDays(d, 1);
  }
  return d;
}

export function scheduleRevisions({ topicId, dateAddedISO, dayIntervals, holidaySet, weeklyOffSet }) {
  const revs = [];
  const sorted = [...dayIntervals].sort((a,b)=>a-b);
  let n = 0;
  for (const interval of sorted) {
    n += 1;
    const original = addDays(dateAddedISO, interval);
    const scheduled = nextWorkDay(original, holidaySet, weeklyOffSet);
    revs.push({
      topicId,
      revisionNum: n,
      dayInterval: interval,
      scheduledDate: scheduled,
      originalDate: original,
      status: "pending",
    });
  }
  return revs;
}

export function distributeDates(startISO, count, spreadDays) {
  // Evenly distribute "count" items across spreadDays (>=2)
  const k = Math.max(2, spreadDays|0);
  const out = [];
  for (let i=0;i<count;i++){
    const offset = Math.floor((i * k) / count);
    out.push(addDays(startISO, offset));
  }
  return out;
}