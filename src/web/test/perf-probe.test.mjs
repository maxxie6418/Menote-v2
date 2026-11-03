import assert from "node:assert/strict";
import test from "node:test";
import { PerfProbe } from "../src/lib/perfProbe.ts";

test("默认关闭：不采样，measure 直接执行", () => {
  const probe = new PerfProbe();
  assert.equal(probe.isEnabled, false);
  let ran = false;
  const value = probe.measure("x", () => { ran = true; return 42; });
  assert.equal(ran, true);
  assert.equal(value, 42);
  probe.record("x", 10);
  assert.equal(probe.summary().length, 0);
});

test("开启后采集并汇总：次数/平均/最长", () => {
  const probe = new PerfProbe();
  probe.enable();
  probe.record("editor.serialize", 10);
  probe.record("editor.serialize", 30);
  const [row] = probe.summary();
  assert.equal(row.name, "editor.serialize");
  assert.equal(row.count, 2);
  assert.equal(row.total, 40);
  assert.equal(row.avg, 20);
  assert.equal(row.max, 30);
  probe.disable();
});

test("P95 取分位样本", () => {
  const probe = new PerfProbe();
  probe.enable();
  for (let i = 1; i <= 100; i += 1) probe.record("n", i);
  const [row] = probe.summary();
  assert.equal(row.count, 100);
  assert.equal(row.p95, 95);
  assert.equal(row.max, 100);
  probe.disable();
});

test("reset 清空已采集数据", () => {
  const probe = new PerfProbe();
  probe.enable();
  probe.record("a", 1);
  assert.equal(probe.summary().length, 1);
  probe.reset();
  assert.equal(probe.summary().length, 0);
  probe.disable();
});

test("导出的 JSON 含指标名与时间戳", () => {
  const probe = new PerfProbe();
  probe.enable();
  probe.record("preview.render", 7);
  const json = JSON.parse(probe.exportJson());
  assert.equal(json.buckets[0].name, "preview.render");
  assert.equal(json.buckets[0].count, 1);
  assert.equal(typeof json.at, "string");
  probe.disable();
});

test("关闭后不再采集", () => {
  const probe = new PerfProbe();
  probe.enable();
  probe.disable();
  probe.record("late", 5);
  assert.equal(probe.summary().length, 0);
});
