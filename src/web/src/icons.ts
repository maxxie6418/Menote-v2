/** 图标清单：集中从这里取 lucide 图标。
 *
 *  为什么不直接 `from "lucide-react"`：该包主入口把 4550 个图标文件全部 re-export，
 *  rollup 必须逐个读取解析才能完成 tree-shaking——本地构建能扛，Cloudflare 构建容器
 *  的文件描述符上限扛不住（`EMFILE: too many open files`，2026-11-11 构建失败）。
 *  改成 `lucide-react/icons/<kebab>` 子路径后只读实际用到的 86 个文件。
 *  新增图标：在这里加一行 `export { default as Xxx } from "lucide-react/icons/xxx";`。
 *  类型（LucideIcon 等）继续从 "lucide-react" 以 `import type` 取——类型在构建时被擦除，
 *  不会触发主入口加载。 */

export { default as Activity } from "lucide-react/icons/activity";
export { default as AlignCenter } from "lucide-react/icons/align-center";
export { default as AlignLeft } from "lucide-react/icons/align-left";
export { default as AlignRight } from "lucide-react/icons/align-right";
export { default as Archive } from "lucide-react/icons/archive";
export { default as ArrowDown } from "lucide-react/icons/arrow-down";
export { default as ArrowLeft } from "lucide-react/icons/arrow-left";
export { default as ArrowRight } from "lucide-react/icons/arrow-right";
export { default as ArrowUp } from "lucide-react/icons/arrow-up";
export { default as ArrowUpDown } from "lucide-react/icons/arrow-up-down";
export { default as ArrowUpRight } from "lucide-react/icons/arrow-up-right";
export { default as Bold } from "lucide-react/icons/bold";
export { default as BookOpen } from "lucide-react/icons/book-open";
export { default as Check } from "lucide-react/icons/check";
export { default as CheckSquare } from "lucide-react/icons/check-square";
export { default as ChevronDown } from "lucide-react/icons/chevron-down";
export { default as ChevronLeft } from "lucide-react/icons/chevron-left";
export { default as ChevronRight } from "lucide-react/icons/chevron-right";
export { default as CircleCheck } from "lucide-react/icons/circle-check";
export { default as CircleHelp } from "lucide-react/icons/circle-help";
export { default as CircleX } from "lucide-react/icons/circle-x";
export { default as Clock } from "lucide-react/icons/clock";
export { default as Clock3 } from "lucide-react/icons/clock-3";
export { default as Code } from "lucide-react/icons/code";
export { default as Copy } from "lucide-react/icons/copy";
export { default as Download } from "lucide-react/icons/download";
export { default as Eraser } from "lucide-react/icons/eraser";
export { default as Eye } from "lucide-react/icons/eye";
export { default as FilePlus2 } from "lucide-react/icons/file-plus-2";
export { default as FileText } from "lucide-react/icons/file-text";
export { default as Filter } from "lucide-react/icons/filter";
export { default as Focus } from "lucide-react/icons/focus";
export { default as Folder } from "lucide-react/icons/folder";
export { default as FolderInput } from "lucide-react/icons/folder-input";
export { default as GripVertical } from "lucide-react/icons/grip-vertical";
export { default as Heading1 } from "lucide-react/icons/heading-1";
export { default as Heading2 } from "lucide-react/icons/heading-2";
export { default as Heading3 } from "lucide-react/icons/heading-3";
export { default as Home } from "lucide-react/icons/home";
export { default as ImagePlus } from "lucide-react/icons/image-plus";
export { default as Inbox } from "lucide-react/icons/inbox";
export { default as Info } from "lucide-react/icons/info";
export { default as Italic } from "lucide-react/icons/italic";
export { default as LayoutGrid } from "lucide-react/icons/layout-grid";
export { default as Link } from "lucide-react/icons/link";
export { default as List } from "lucide-react/icons/list";
export { default as ListOrdered } from "lucide-react/icons/list-ordered";
export { default as ListTodo } from "lucide-react/icons/list-todo";
export { default as ListTree } from "lucide-react/icons/list-tree";
export { default as Lock } from "lucide-react/icons/lock";
export { default as LockOpen } from "lucide-react/icons/lock-open";
export { default as LockKeyhole } from "lucide-react/icons/lock-keyhole";
export { default as LogOut } from "lucide-react/icons/log-out";
export { default as Menu } from "lucide-react/icons/menu";
export { default as MessageCircle } from "lucide-react/icons/message-circle";
export { default as MessageSquarePlus } from "lucide-react/icons/message-square-plus";
export { default as Minus } from "lucide-react/icons/minus";
export { default as MoreHorizontal } from "lucide-react/icons/more-horizontal";
export { default as PanelLeftClose } from "lucide-react/icons/panel-left-close";
export { default as PanelLeftOpen } from "lucide-react/icons/panel-left-open";
export { default as Paperclip } from "lucide-react/icons/paperclip";
export { default as Pencil } from "lucide-react/icons/pencil";
export { default as Pin } from "lucide-react/icons/pin";
export { default as Plus } from "lucide-react/icons/plus";
export { default as Quote } from "lucide-react/icons/quote";
export { default as RefreshCw } from "lucide-react/icons/refresh-cw";
export { default as Repeat2 } from "lucide-react/icons/repeat-2";
export { default as RotateCcw } from "lucide-react/icons/rotate-ccw";
export { default as Rows3 } from "lucide-react/icons/rows-3";
export { default as Search } from "lucide-react/icons/search";
export { default as Settings } from "lucide-react/icons/settings";
export { default as Shield } from "lucide-react/icons/shield";
export { default as ShieldOff } from "lucide-react/icons/shield-off";
export { default as SlidersHorizontal } from "lucide-react/icons/sliders-horizontal";
export { default as Sparkles } from "lucide-react/icons/sparkles";
export { default as SquareCode } from "lucide-react/icons/square-code";
export { default as Star } from "lucide-react/icons/star";
export { default as StickyNote } from "lucide-react/icons/sticky-note";
export { default as Strikethrough } from "lucide-react/icons/strikethrough";
export { default as Table2 } from "lucide-react/icons/table-2";
export { default as Tag } from "lucide-react/icons/tag";
export { default as Tags } from "lucide-react/icons/tags";
export { default as Trash2 } from "lucide-react/icons/trash-2";
export { default as Type } from "lucide-react/icons/type";
export { default as UserRound } from "lucide-react/icons/user-round";
export { default as X } from "lucide-react/icons/x";
export { default as Zap } from "lucide-react/icons/zap";
