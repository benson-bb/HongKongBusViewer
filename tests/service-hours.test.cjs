const test = require('node:test');
const assert = require('node:assert/strict');
const { getHongKongClock, isOperatingAt, parseScheduleMinute } = require('../assets/service-hours.js');

test('uses Hong Kong local weekday and time even when the computer is in another time zone', () => {
  assert.deepEqual(getHongKongClock(new Date('2026-10-23T16:30:00Z')), {
    day: 5,
    minute: 30,
    time: '00:30'
  });
});

test('matches inclusive start and exclusive end of frequency windows', () => {
  const patterns = [{ q: [{ d: '1000000', w: [{ s: '05:30', e: '23:00' }] }] }];
  assert.equal(isOperatingAt(patterns, 0, 309), false); // 05:09, 21 minutes before service starts
  assert.equal(isOperatingAt(patterns, 0, 310), true); // 05:10, 20 minutes before service starts
  assert.equal(isOperatingAt(patterns, 0, 330), true);
  assert.equal(isOperatingAt(patterns, 0, 1379), true);
  assert.equal(isOperatingAt(patterns, 0, 1380), false);
  assert.equal(isOperatingAt(patterns, 1, 600), false);
});

test('keeps after-midnight service attached to the previous service day', () => {
  const patterns = [{ q: [{ d: '1000000', w: [{ s: '22:00', e: '25:00' }] }] }];
  assert.equal(isOperatingAt(patterns, 1, 30), true);
  assert.equal(isOperatingAt(patterns, 1, 60), false);
});

test('shows exact-timetable routes only during trips or within 20 minutes of a departure', () => {
  const patterns = [{ q: [{
    d: '0000010',
    t: ['07:37', '07:52', '18:00', '18:15'],
    r: [['07:37', '08:35'], ['07:52', '08:50'], ['18:00', '19:00'], ['18:15', '19:15']]
  }] }];
  assert.equal(isOperatingAt(patterns, 5, 436), false); // 07:16, 21 minutes before departure
  assert.equal(isOperatingAt(patterns, 5, 437), true); // 07:17, 20 minutes before departure
  assert.equal(isOperatingAt(patterns, 5, 490), true); // 08:10, during the morning trips
  assert.equal(isOperatingAt(patterns, 5, 720), false); // 12:00, no trip or near departure
  assert.equal(isOperatingAt(patterns, 5, 1059), false); // 17:39, 21 minutes before the evening trips
  assert.equal(isOperatingAt(patterns, 5, 1060), true); // 17:40, 20 minutes before departure
  assert.equal(isOperatingAt(patterns, 5, 1110), true); // 18:30, during the evening trips
  assert.equal(isOperatingAt(patterns, 5, 1155), false); // 19:15, final trip end is exclusive
  assert.equal(isOperatingAt(patterns, 4, 500), false);
});

test('supports GTFS departures after midnight and returns false when no schedule exists', () => {
  const patterns = [{ q: [{ d: '0000001', t: ['23:30', '24:30'], r: [['23:30', '25:10']] }] }];
  assert.equal(isOperatingAt(patterns, 0, 30), true);
  assert.equal(isOperatingAt(patterns, 0, 60), true);
  assert.equal(isOperatingAt(patterns, 0, 71), false);
  assert.equal(isOperatingAt([], 0, 30), false);
  assert.equal(parseScheduleMinute('25:10'), 1510);
});

test('uses only upcoming departures for legacy timetables without trip spans', () => {
  const patterns = [{ q: [{ d: '1000000', t: ['06:15', '09:30', '22:10'], r: [] }] }];
  assert.equal(isOperatingAt(patterns, 0, 500), false);
  assert.equal(isOperatingAt(patterns, 0, 550), true); // 09:10, 20 minutes before departure
  assert.equal(isOperatingAt(patterns, 0, 549), false);
  assert.equal(isOperatingAt(patterns, 0, 1331), false);
});
