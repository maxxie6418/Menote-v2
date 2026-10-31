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
