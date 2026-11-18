/** Obsidian 导入的本地文件读取适配（FR-IMP-2）。
 *
 *  浏览器拿不到真实「本地路径」，三种添加方式统一收敛为 `ObsidianScannedFile[]`：
 *  - 整库/文件夹：Chromium 走 File System Access API 选目录；其它浏览器用 `<input webkitdirectory>` 兜底；
 *  - 拖拽：DataTransferItem.webkitGetAsEntry 递归读目录树，不支持时退回纯文件列表；
 *  - 单个/多个 .md：`<input type="file" multiple>`。
 *  只做 I/O 编排，不做分类与解析（见 obsidianParse.ts）。 */

import type { ObsidianScannedFile } from "./obsidianParse";

interface LegacyDirectoryPicker {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}

/** 递归展开一个目录句柄（File System Access API）。 */
async function scanDirectoryHandle(handle: FileSystemDirectoryHandle, prefix: string, out: ObsidianScannedFile[]): Promise<void> {
  for await (const entry of handle.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.push({ path, file });
    } else {
      await scanDirectoryHandle(entry as FileSystemDirectoryHandle, `${path}/`, out);
    }
  }
}

/** 选择整库或文件夹（Chromium）；环境不支持时返回 null，由调用方走 webkitdirectory 兜底。 */
export async function pickObsidianDirectory(): Promise<{ files: ObsidianScannedFile[]; rootLabel: string } | null> {
  const picker = (window as unknown as LegacyDirectoryPicker).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker.call(window, { mode: "read" });
  const files: ObsidianScannedFile[] = [];
  await scanDirectoryHandle(handle, "", files);
  return { files, rootLabel: handle.name };
}

/** webkitdirectory 兜底：返回的 File 带相对路径（webkitRelativePath 含所选目录名）。 */
export function readDirectoryInput(input: HTMLInputElement): ObsidianScannedFile[] {
  return Array.from(input.files ?? []).map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }));
}

/** 单个/多个 .md 文件（File 路径只有文件名，图片缺失属预期行为）。 */
export function readFileInput(input: HTMLInputElement): ObsidianScannedFile[] {
  return Array.from(input.files ?? []).map((file) => ({ path: file.name, file }));
}

interface ReadEntriesReader {
  readEntries(success: (entries: FileSystemEntry[]) => void, failure?: (cause: DOMException) => void): void;
}

interface DirectoryEntry extends FileSystemEntry {
  isDirectory: boolean;
  isFile: boolean;
  createReader(): ReadEntriesReader;
  file(success: (file: File) => void, failure?: (cause: DOMException) => void): void;
}

/** readEntries 每次只返回一批，必须读到空数组为止。 */
function readAllEntries(reader: ReadEntriesReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const step = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) { resolve(all); return; }
        all.push(...batch);
        step();
      }, reject);
    };
    step();
  });
}

function entryAsDirectory(entry: FileSystemEntry): DirectoryEntry | null {
  return "createReader" in entry ? (entry as DirectoryEntry) : null;
}

async function scanEntry(entry: FileSystemEntry, prefix: string, out: ObsidianScannedFile[]): Promise<void> {
  const path = `${prefix}${entry.name}`;
  const directory = entryAsDirectory(entry);
  if (directory) {
    const entries = await readAllEntries(directory.createReader());
    for (const child of entries) await scanEntry(child, `${path}/`, out);
    return;
  }
  const fileEntry = entry as DirectoryEntry;
  const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
  out.push({ path, file });
}

/** 拖拽读入：优先逐项 webkitGetAsEntry（支持文件夹）；取不到 entry 时退回普通文件列表。 */
export async function readDroppedItems(items: DataTransferItemList): Promise<ObsidianScannedFile[]> {
  const entries: Array<FileSystemEntry | null> = [];
  for (const item of Array.from(items)) entries.push(item.webkitGetAsEntry?.() ?? null);
  if (entries.some((entry) => entry !== null)) {
    const out: ObsidianScannedFile[] = [];
    for (const entry of entries) if (entry) await scanEntry(entry, "", out);
    return out;
  }
  const files = Array.from(items).map((item) => item.getAsFile()).filter((file): file is File => file !== null);
  return files.map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}
