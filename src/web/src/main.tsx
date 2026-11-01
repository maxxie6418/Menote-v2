import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// 界面默认字体：自托管 Noto Sans SC（@fontsource 按 unicode-range 分片，浏览器只拉用到的分片）。
// 字重与 tokens.css 用量对应：正文 400 / medium 600 / 标题与强调 500、700；设置·外观可切回系统栈。
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-sans-sc/700.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/shell.css";
import "./styles/markdown.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
