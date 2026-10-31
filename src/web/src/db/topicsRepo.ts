import type { TopicNode } from "@menote/shared";
import { localDb } from "./localDb";

/** 主题/分组本地读写；父子层级合法性由命令层校验（depth 0 主题 / 1 分组）。 */

export async function listTopics(userId: string): Promise<TopicNode[]> {
  return localDb.topics.where("userId").equals(userId).toArray();
}

export async function getTopic(userId: string, id: string): Promise<TopicNode | undefined> {
  return localDb.topics.get(id).then((row) => (row && row.userId === userId ? row : undefined));
}

export async function putTopic(topic: TopicNode): Promise<void> {
  await localDb.topics.put(topic);
}

export async function listSubtreeIds(userId: string, topicId: string): Promise<string[]> {
  const children = await localDb.topics
    .where("userId").equals(userId)
    .filter((row) => row.parentId === topicId)
    .toArray();
  return [topicId, ...children.map((row) => row.id)];
}
