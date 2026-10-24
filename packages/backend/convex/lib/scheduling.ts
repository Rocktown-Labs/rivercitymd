const CENTRAL_TIME_ZONE = "America/Chicago";

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const targetWallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utc = targetWallClockAsUtc;

  // Two passes handle the DST offset changing between the guess and the target.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = getTimeZoneParts(new Date(utc), timeZone);
    const formattedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    utc += targetWallClockAsUtc - formattedAsUtc;
  }

  return utc;
}

export function getCentralHour(nowMs = Date.now()): number {
  return getTimeZoneParts(new Date(nowMs), CENTRAL_TIME_ZONE).hour;
}

export function getNextNineAmCentral(nowMs = Date.now()): number {
  const nowParts = getTimeZoneParts(new Date(nowMs), CENTRAL_TIME_ZONE);
  let targetYear = nowParts.year;
  let targetMonth = nowParts.month;
  let targetDay = nowParts.day;

  if (nowParts.hour >= 9) {
    // Noon UTC keeps the calendar date stable when formatted in Central.
    const nextDay = new Date(
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1, 12, 0, 0),
    );
    const nextParts = getTimeZoneParts(nextDay, CENTRAL_TIME_ZONE);
    targetYear = nextParts.year;
    targetMonth = nextParts.month;
    targetDay = nextParts.day;
  }

  return zonedTimeToUtc(
    targetYear,
    targetMonth,
    targetDay,
    9,
    0,
    CENTRAL_TIME_ZONE,
  );
}
