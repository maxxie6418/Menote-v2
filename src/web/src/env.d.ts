declare const __APP_VERSION__: string;
declare const __APP_BUILD_COMMIT__: string;
declare const __APP_BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite 的 ?raw 后缀导入（构建期把文件原文作为字符串内联），当前仅用于登录检查屏内联 public/icon.svg。
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
