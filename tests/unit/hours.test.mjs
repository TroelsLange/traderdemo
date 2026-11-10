import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStartUtc, hourly, productSlots, slotHours, slotLabels } from "../../netlify/lib/hours.mts";

test("almindelig dag har 24 timer", () => {
  assert.equal(slotHours("2026-11-10").length, 24);
  assert.equal(dayStartUtc("2026-11-10"), Date.parse("2026-11-09T23:00:00Z"));
  assert.equal(dayStartUtc("2026-07-01"), Date.parse("2026-06-30T22:00:00Z"));
});

test("vintertid begynder: 25 timer med 02A og 02B", () => {
  assert.equal(slotHours("2026-10-25").length, 25);
  assert.deepEqual(slotLabels("2026-10-25").slice(0, 5), ["00", "01", "02A", "02B", "03"]);
  assert.equal(productSlots("base", "2026-10-25").length, 25);
  assert.equal(productSlots("peak", "2026-10-25").length, 12);
  assert.equal(productSlots("offpeak", "2026-10-25").length, 13);
  assert.deepEqual(productSlots("block", "2026-10-25", 2, 3), [2, 3]);
});

test("sommertid begynder: 23 timer uden time 02", () => {
  assert.equal(slotHours("2027-03-28").length, 23);
  assert.deepEqual(slotLabels("2027-03-28").slice(0, 3), ["00", "01", "03"]);
  assert.equal(productSlots("offpeak", "2027-03-28").length, 11);
  assert.deepEqual(productSlots("block", "2027-03-28", 2, 3), []);
});

test("timepris bruger UTC-tid, så den dobbelte time ikke blandes", () => {
  const q = (u, eur) => ({ t: "", u, eur });
  const quarters = [
    ...[0, 15, 30, 45].map((m) => q(`2026-10-25T00:${String(m).padStart(2, "0")}:00`, 10)), // 02A
    ...[0, 15, 30, 45].map((m) => q(`2026-10-25T01:${String(m).padStart(2, "0")}:00`, 20)), // 02B
  ];
  const h = hourly(quarters, "2026-10-25");
  assert.equal(h.length, 25);
  assert.equal(h[2], 10);
  assert.equal(h[3], 20);
  assert.equal(h[0], null);
});
