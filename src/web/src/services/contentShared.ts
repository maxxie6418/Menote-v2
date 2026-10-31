import type { Item, TopicNode } from "@menote/shared";
import { localDb, type OutboxRow } from "../db/localDb";
import { toOutboxRow } from "../db/outboxRepo";
import { getItem } from "../db/itemsRepo";
import { newId } from "../lib/hash";

/** 内容命令共享底座（G10 整理拆分）：写队列、载荷组装、条目读取、信封打包。
 *  contentService / versionService / encryptionCommandService 共用，禁止互相反查。 */

/** 写命令串行队列：正文自动保存、标题防抖与属性区预览态编辑走同一链路（FR-PROP-3），
 *  读-改-写按序执行，避免并发相互覆盖。 */
let writeChain: Promise<unknown> = Promise.resolve();

export function enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = writeChain.then(write, write);
  writeChain = next.catch(() => {});
  return next;
}

export function outboxUpsert(item: Item, baseRev: number, baseMetaRev: number, contentHash?: string): OutboxRow {
  return toOutboxRow({
    operationId: newId(), userId: item.userId, entityId: item.id, entity: "item",
    action: "upsert", baseRev, baseMetaRev, contentHash, payload: { item },
  }, Date.now());
}

export function outboxTopic(topic: TopicNode, action: "upsert" | "delete"): OutboxRow {
  return toOutboxRow({
    operationId: newId(), userId: topic.userId, entityId: topic.id, entity: "topic",
    action, baseRev: 0, baseMetaRev: 0, payload: { topic },
  }, Date.now());
}

export function requireItem(userId: string, id: string): Promise<Item> {
  return getItem(userId, id).then((item) => {
    if (!item) throw new Error(`item not found: ${id}`);
    return item;
  });
}

/** 加密信封打包/解包（运行时存储格式 iv:ciphertext）。 */
export function packEnvelope(iv: string, ciphertext: string): string {
  return `${iv}:${ciphertext}`;
}

export function unpackEnvelope(sealed: string): { iv: string; ciphertext: string } {
  const [iv, ...rest] = sealed.split(":");
  if (!iv || rest.length === 0) throw new Error("corrupt_envelope");
  return { iv, ciphertext: rest.join(":") };
}
