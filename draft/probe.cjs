// 用 CDP 无需第三方库：启动 chrome --remote-debugging-port 后用 http+ws 查询不便，
// 改用 --dump-dom 拿不到几何信息。这里改用 chrome 的 --virtual-time-budget 截图配合
// 逐屏扫描：直接找页面中浅色/深色 sb-demo 的位置不现实，改为输出整页后人工定位。
