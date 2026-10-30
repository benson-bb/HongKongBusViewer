(function (root, factory) {
  const serviceHours = factory();
  if (typeof module === 'object' && module.exports) module.exports = serviceHours;
  if (root) root.HKServiceHours = serviceHours;
})(typeof window !== 'undefined' ? window : null, function () {
  const departureLookaheadMinutes = 20;
  const weekdayIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  function getHongKongClock(date = new Date()) {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    return {
      day: weekdayIndex[parts.weekday],
      minute: hour * 60 + minute,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    };
  }

  function parseScheduleMinute(value) {
    const match = /^(\d{1,3}):(\d{2})$/.exec(String(value || ''));
    if (!match) return NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return minutes < 60 ? hours * 60 + minutes : NaN;
  }

  function scheduleRunsAt(schedule, day, minute) {
    const days = String(schedule.d || '');
    const serviceTimes = [
      { day, minute },
      { day: (day + 6) % 7, minute: minute + 1440 }
    ];

    for (const serviceTime of serviceTimes) {
      if (days[serviceTime.day] !== '1') continue;

      for (const window of schedule.w || []) {
        const start = parseScheduleMinute(window.s);
        const end = parseScheduleMinute(window.e);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        if (serviceTime.minute >= start && serviceTime.minute < end) return true;
        if (start >= serviceTime.minute && start <= serviceTime.minute + departureLookaheadMinutes) return true;
      }

      if (Array.isArray(schedule.r)) {
        const runs = schedule.r.map(run => {
          if (!Array.isArray(run) || run.length < 2) return null;
          const start = parseScheduleMinute(run[0]);
          const end = parseScheduleMinute(run[1]);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
          return { start, end };
        }).filter(Boolean);
        if (runs.length) {
          if (runs.some(run =>
            (serviceTime.minute >= run.start && serviceTime.minute < run.end) ||
            (run.start >= serviceTime.minute && run.start <= serviceTime.minute + departureLookaheadMinutes)
          )) return true;
          continue;
        }
      }

      const departures = (schedule.t || []).map(parseScheduleMinute).filter(Number.isFinite);
      if (departures.some(departure =>
        departure >= serviceTime.minute && departure <= serviceTime.minute + departureLookaheadMinutes
      )) return true;
    }
    return false;
  }

  function isOperatingAt(patterns, day, minute) {
    return (patterns || []).some(pattern => (pattern.q || []).some(schedule => scheduleRunsAt(schedule, day, minute)));
  }

  return Object.freeze({ getHongKongClock, isOperatingAt, parseScheduleMinute });
});
