/** 服务端错误码 → 面向用户的中文提示；未知码走兜底。 */
export function authErrorText(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "用户名或口令格式不正确：用户名 1～32 个字符，口令至少 8 位。";
    case "invalid_login":
      return "用户名或口令不正确。";
    case "bootstrap_closed":
      return "初始化已完成，请直接登录。";
    case "username_taken":
      return "该用户名已被使用。";
    case "bootstrap_required":
      return "应用尚未初始化，请先创建管理员账号。";
    case "registration_closed":
      return "当前未开放注册，请联系管理员。";
    case "owner_only":
      return "仅管理员可以执行此操作。";
    case "too_many_attempts":
      return "尝试过于频繁，请稍后再试。";
    case "cross_origin":
      return "请求来源校验失败，请从应用页面重试。";
    case "auth_unconfigured":
      return "服务尚未完成配置（缺少部署密钥），请联系部署者。";
    case "unavailable":
      return "服务暂不可用，请稍后重试。";
    case "network":
      return "网络连接失败，请检查网络后重试。";
    default:
      return code.startsWith("http_") ? "服务返回异常，请稍后重试。" : "操作未完成，请稍后重试。";
  }
}
