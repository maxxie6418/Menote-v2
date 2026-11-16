/** 附件名净化（FR-SYNC-7）：Markdown 链接目标不能含空格与括号，
 *  像「截图 2026-11-02 13.39.07.png」这种名字会把 `![x](attachments/…)` 截断，图片因此永远解析不出来。
 *  往返映射与正文引用必须用同一个名字，所以净化动作必须在入库前统一做一次。
 *  放在 lib 层：编辑器与导入服务都要用同一份口径。 */

export function safeAttachmentName(name: string): string {
  return name.replace(/[\s()[\]<>|]+/g, "-");
}
