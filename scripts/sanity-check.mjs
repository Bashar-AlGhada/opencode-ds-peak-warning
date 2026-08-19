import {
  DEFAULT_RANGES,
  contains,
  formatDuration,
  formatMinutes,
  minutesUntilStart,
  nextTransition,
  parseRange,
  sanitizeRanges,
  statusAt,
  toMinutes,
  utcMinutes,
} from "../src/ranges.ts"

let failures = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`FAIL ${name}: got ${a}, expected ${e}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

const M = (hh) => toMinutes(hh)
const peak = (time) => statusAt(DEFAULT_RANGES, M(time)).peak

// --- statusAt: defaults are peak 01:00-04:00 and 06:00-10:00 UTC ---
check("00:59 off-peak", peak("00:59"), false)
check("01:00 peak (inclusive start)", peak("01:00"), true)
check("03:59 peak", peak("03:59"), true)
check("04:00 off-peak (exclusive end)", peak("04:00"), false)
check("05:59 off-peak", peak("05:59"), false)
check("06:00 peak (second window)", peak("06:00"), true)
check("09:59 peak", peak("09:59"), true)
check("10:00 off-peak (exclusive end)", peak("10:00"), false)
check("23:59 off-peak", peak("23:59"), false)
check("empty ranges -> always off-peak", statusAt([], M("02:00")).peak, false)
check("statusAt returns matching range", statusAt(DEFAULT_RANGES, M("02:00")), {
  peak: true,
  range: { start: "01:00", end: "04:00" },
})

// --- nextTransition with defaults ---
check("transition 03:30 -> off-peak at 04:00", nextTransition(DEFAULT_RANGES, M("03:30")), { at: M("04:00"), to: false })
check("transition 00:30 -> peak at 01:00", nextTransition(DEFAULT_RANGES, M("00:30")), { at: M("01:00"), to: true })
check("transition 05:30 -> peak at 06:00", nextTransition(DEFAULT_RANGES, M("05:30")), { at: M("06:00"), to: true })
check("transition 10:30 -> next-day peak 01:00", nextTransition(DEFAULT_RANGES, M("10:30")), { at: M("01:00"), to: true })
check("transition at 04:00 -> peak at 06:00", nextTransition(DEFAULT_RANGES, M("04:00")), { at: M("06:00"), to: true })
check("transition 23:00 -> next-day peak 01:00", nextTransition(DEFAULT_RANGES, M("23:00")), { at: M("01:00"), to: true })

// --- midnight-wrapping window 22:00-02:00 ---
const wrap = [{ start: "22:00", end: "02:00" }]
check("wrap 21:59 off-peak", statusAt(wrap, M("21:59")).peak, false)
check("wrap 22:00 peak", statusAt(wrap, M("22:00")).peak, true)
check("wrap 23:59 peak", statusAt(wrap, M("23:59")).peak, true)
check("wrap 00:00 peak (after midnight)", statusAt(wrap, M("00:00")).peak, true)
check("wrap 01:59 peak", statusAt(wrap, M("01:59")).peak, true)
check("wrap 02:00 off-peak (exclusive end)", statusAt(wrap, M("02:00")).peak, false)
check("wrap 02:30 -> next 22:00 peak", nextTransition(wrap, M("02:30")), { at: M("22:00"), to: true })
check("wrap 23:00 -> off-peak at 02:00", nextTransition(wrap, M("23:00")), { at: M("02:00"), to: false })

// --- full-day window 00:00-00:00 is always peak ---
const allDay = [{ start: "00:00", end: "00:00" }]
check("all-day 12:00 peak", statusAt(allDay, M("12:00")).peak, true)
check("all-day 23:59 peak", statusAt(allDay, M("23:59")).peak, true)

// --- contains boundary semantics ---
check("contains 01:00 in 01:00-04:00", contains(M("01:00"), DEFAULT_RANGES[0]), true)
check("contains 03:59 in 01:00-04:00", contains(M("03:59"), DEFAULT_RANGES[0]), true)
check("contains 04:00 exclusive", contains(M("04:00"), DEFAULT_RANGES[0]), false)
check("contains 00:59 outside", contains(M("00:59"), DEFAULT_RANGES[0]), false)
check("contains 06:00 in wrap window", contains(M("00:00"), wrap[0]), true)
check("contains 02:00 exclusive in wrap", contains(M("02:00"), wrap[0]), false)
check("contains all-day always true", contains(M("12:34"), allDay[0]), true)

// --- minutesUntilStart (per-window next occurrence) ---
check("next 00:00 -> 01:00 (60m)", minutesUntilStart(DEFAULT_RANGES[0], M("00:00")), { active: false, minutes: 60 })
check("next 00:59 -> 01:00 (1m)", minutesUntilStart(DEFAULT_RANGES[0], M("00:59")), { active: false, minutes: 1 })
check("next 01:00 -> active (inclusive start)", minutesUntilStart(DEFAULT_RANGES[0], M("01:00")), { active: true, minutes: 0 })
check("next 03:00 -> active", minutesUntilStart(DEFAULT_RANGES[0], M("03:00")), { active: true, minutes: 0 })
check("next 04:00 -> next day 01:00 (1260m)", minutesUntilStart(DEFAULT_RANGES[0], M("04:00")), { active: false, minutes: 1260 })
check("next 04:30 -> next day 01:00 (1230m)", minutesUntilStart(DEFAULT_RANGES[0], M("04:30")), { active: false, minutes: 1230 })
check("next 23:00 -> next day 01:00 (120m)", minutesUntilStart(DEFAULT_RANGES[0], M("23:00")), { active: false, minutes: 120 })
check("next 04:00 for 06:00 window (120m)", minutesUntilStart(DEFAULT_RANGES[1], M("04:00")), { active: false, minutes: 120 })
check("next wrap 21:59 -> 22:00 (1m)", minutesUntilStart(wrap[0], M("21:59")), { active: false, minutes: 1 })
check("next wrap 02:30 -> next 22:00 (1170m)", minutesUntilStart(wrap[0], M("02:30")), { active: false, minutes: 1170 })
check("next wrap 23:30 -> active", minutesUntilStart(wrap[0], M("23:30")), { active: true, minutes: 0 })
check("next all-day -> active always", minutesUntilStart(allDay[0], M("12:00")), { active: true, minutes: 0 })

// --- formatDuration ---
check("formatDuration 0 -> 0m", formatDuration(0), "0m")
check("formatDuration 1 -> 1m", formatDuration(1), "1m")
check("formatDuration 45 -> 45m", formatDuration(45), "45m")
check("formatDuration 59 -> 59m", formatDuration(59), "59m")
check("formatDuration 60 -> 1h", formatDuration(60), "1h")
check("formatDuration 65 -> 1h 5m", formatDuration(65), "1h 5m")
check("formatDuration 120 -> 2h", formatDuration(120), "2h")
check("formatDuration 1230 -> 20h 30m", formatDuration(1230), "20h 30m")
check("formatDuration 1440 -> 24h", formatDuration(1440), "24h")
check("formatDuration negative -> 0m", formatDuration(-5), "0m")

// --- parseRange ---
check("parse simple", parseRange("01:00-04:00"), { start: "01:00", end: "04:00" })
check("parse with spaces", parseRange(" 01:00 - 04:00 "), { start: "01:00", end: "04:00" })
check("parse en-dash", parseRange("22:00–02:00"), { start: "22:00", end: "02:00" })
check("parse em-dash", parseRange("22:00—02:00"), { start: "22:00", end: "02:00" })
check("parse midnight full-day", parseRange("00:00-00:00"), { start: "00:00", end: "00:00" })
check("parse single-digit hours", parseRange("1:00-4:00"), { start: "1:00", end: "4:00" })
check("parse rejects status suffix", parseRange("01:00-04:00 peak"), null)
check("parse rejects garbage", parseRange("garbage"), null)
check("parse rejects invalid hour", parseRange("25:00-04:00"), null)
check("parse rejects invalid minute", parseRange("01:60-04:00"), null)
check("parse rejects missing end", parseRange("01:00-"), null)
check("parse rejects single time", parseRange("01:00"), null)
check("parse rejects empty", parseRange("  "), null)

// --- sanitizeRanges ---
check("sanitize keeps valid", sanitizeRanges([{ start: "01:00", end: "04:00" }]), [{ start: "01:00", end: "04:00" }])
check("sanitize drops legacy status field", sanitizeRanges([{ start: "01:00", end: "04:00", status: "peak" }]), [
  { start: "01:00", end: "04:00" },
])
check("sanitize drops invalid times", sanitizeRanges([{ start: "nope", end: "x" }, { start: "01:00", end: "25:00" }]), [])
check("sanitize drops non-objects", sanitizeRanges([null, "hi", 42, undefined]), [])
check("sanitize drops missing fields", sanitizeRanges([{ start: "01:00" }, { end: "04:00" }, {}]), [])
check("sanitize empty input", sanitizeRanges([]), [])
check("sanitize mixed keeps valid only", sanitizeRanges([{ start: "01:00", end: "04:00" }, null, "x", { start: "22:00", end: "02:00" }]), [
  { start: "01:00", end: "04:00" },
  { start: "22:00", end: "02:00" },
])

// --- toMinutes / formatMinutes ---
check("toMinutes 00:00 -> 0", toMinutes("00:00"), 0)
check("toMinutes 23:59 -> 1439", toMinutes("23:59"), 1439)
check("toMinutes 1:30 -> 90", toMinutes("1:30"), 90)
check("formatMinutes 0 -> 00:00", formatMinutes(0), "00:00")
check("formatMinutes 1439 -> 23:59", formatMinutes(1439), "23:59")
check("formatMinutes 1440 wraps -> 00:00", formatMinutes(1440), "00:00")
check("formatMinutes -1 wraps -> 23:59", formatMinutes(-1), "23:59")

// --- utcMinutes reflects the real UTC clock ---
const now = new Date()
check("utcMinutes matches getUTC*", utcMinutes(now), now.getUTCHours() * 60 + now.getUTCMinutes())

console.log(failures === 0 ? "\nAll sanity checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)