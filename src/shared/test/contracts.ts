import type { Item, StoredContent } from "../src/index";

declare const item: Item;
if (item.type === "memo") {
  const markdown: string = item.content.markdown;
  void markdown;
}
const plaintext: StoredContent = { scope: "plain", markdown: "test" };
const ciphertext: StoredContent = { scope: "self", ciphertext: "test" };
void plaintext; void ciphertext;
// @ts-expect-error encrypted content cannot have a plaintext markdown field
const invalid: StoredContent = { scope: "self", markdown: "test" };
void invalid;

// TP8：AI 契约编译检查（设置归一、任务结果判别联合）。
import { AI_MODEL_OPTIONS, DEFAULT_AI_SETTINGS, normalizeAiSettings } from "../src/index";
import type { AiSettings, AiTaskResult, AiTaskView, AiUsageSummary } from "../src/index";

const normalized: AiSettings = normalizeAiSettings({ enabled: true, model: "@cf/zai-org/glm-4.7-flash", dailyCallLimit: 10 });
if (normalized.model !== AI_MODEL_OPTIONS[0].id) throw new Error("model option mismatch");
const fallback: AiSettings = normalizeAiSettings(undefined);
if (fallback.enabled !== DEFAULT_AI_SETTINGS.enabled) throw new Error("default fallback mismatch");
const result: AiTaskResult = { type: "summary", summary: "s" };
const tags: AiTaskResult = { type: "tags", tags: ["a"] };
void result; void tags;
declare const view: AiTaskView;
if (view.status === "done" && view.result === null) throw new Error("done task carries result");
declare const usage: AiUsageSummary;
void usage.freeNeuronsDaily;
