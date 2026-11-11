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
import "./styles/slate.css";
import "./styles/app.css";
import "./styles/shell.css";
import "./styles/doc.css";
import "./styles/table.css";
import "./styles/markdown.css";
import "./styles/memo.css";
import "./styles/home.css";
import "./styles/mobile.css";
// 滚动条：全局接管所有原生滚动容器（DESIGN §4.4），须在 tokens.css 之后引入以取到令牌。
import "./styles/scrollbar.css";
import "./styles/inkstand-shell.css";
import "./styles/inkstand-memo.css";
import "./styles/inkstand-pages.css";
import { applyDocStyle } from "./lib/docStyle";
import { getThemeSkin } from "./lib/themeSkin";
import { getDensityPreference } from "./lib/density";
import { applyDocLayout } from "./lib/docLayout";
import { installScrollHot } from "./lib/scrollHot";

// 文档样式偏好（FR-STYLE-2）：index.html 已按存储值写过一次，这里兜底重放（热更新/早期异常时两者不会打架）。
applyDocStyle();
// 皮肤与文档区布局（属性位置 / 工具栏位置）在首屏即落属性，避免切换时闪一版默认形态。
getThemeSkin();
applyDocLayout();
// 界面密度（根字号一档）：同样在首屏落 data-density，否则会先按 16px 排完再跳一档。
getDensityPreference();
// 滚动条只在指针所在的滚动区浮现（DESIGN §4.3）：全局挂一次指针热态监听。
installScrollHot();

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
