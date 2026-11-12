import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Activity, LogOut, SlidersHorizontal } from "../icons";
import { getThemeMode, setThemeMode, subscribeTheme, type ThemeMode } from "../lib/theme";
import { APP_BUILD_LABEL, APP_VERSION_LABEL } from "../lib/version";
import { updateAppearance } from "../services/appearanceSettingsService";

const THEME_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: "system", label: "跟随系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

interface AccountMenuProps {
  userId: string;
  username: string;
  role: "owner" | "member";
  collapsed: boolean;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenStatus: () => void;
}

/** 侧栏脚部账户菜单：主题、系统状态、设置与退出登录。菜单用 fixed 定位逃出侧栏 overflow 裁剪。 */
export function AccountMenu({ userId, username, role, collapsed, onLogout, onOpenSettings, onOpenStatus }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => subscribeTheme(() => setMode(getThemeMode())), []);

  // 连接状态点：跟随浏览器在线状态（真实状态，不伪造同步进度）
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({
        left: Math.max(0, Math.min(rect.left, window.innerWidth - (menuRef.current?.offsetWidth ?? 0))),
        bottom: window.innerHeight - rect.top,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // 动态定位走 DOM API（结构检查禁止 JSX style prop）
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    menuRef.current.style.left = `${position.left}px`;
    menuRef.current.style.bottom = `${position.bottom}px`;
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={triggerRef} className="mn-foot-user" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`账户菜单，${username}（${role === "owner" ? "管理员" : "成员"}）`}
        title={`${username}（${role === "owner" ? "管理员" : "成员"}）`}
        onClick={() => setOpen((value) => !value)}>
        <span className="mn-ava" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
        {!collapsed && <span className="mn-foot-user-name">{username}</span>}
        {!collapsed && <span className="mn-sync" role="img" aria-label={online ? "已连接" : "离线"} title={online ? "已连接" : "离线"} />}
        {!collapsed && <span className="mn-foot-version" title={APP_BUILD_LABEL}>{APP_VERSION_LABEL}</span>}
      </button>
      {open && (
        <div id={menuId} ref={menuRef} className="mn-account-menu" role="menu" aria-label="账户菜单">
          <p className="mn-menu-label">主题</p>
          <div className="mn-menu-seg" role="radiogroup" aria-label="主题模式">
            {THEME_OPTIONS.map((option) => (
              <button key={option.mode} type="button" role="radio" aria-checked={mode === option.mode}
                className={mode === option.mode ? "on" : ""}
                onClick={() => { setThemeMode(option.mode); void updateAppearance(userId, { theme: option.mode }); }}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="mn-menu-sep" role="separator" />
          <button type="button" className="mn-menu-item" role="menuitem"
            onClick={() => { setOpen(false); onOpenStatus(); }}>
            <Activity aria-hidden="true" />
            系统状态
          </button>
          <button type="button" className="mn-menu-item" role="menuitem"
            onClick={() => { setOpen(false); onOpenSettings(); }}>
            <SlidersHorizontal aria-hidden="true" />
            设置
          </button>
          <button type="button" className="mn-menu-item" role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut aria-hidden="true" />
            退出登录
          </button>
        </div>
      )}
    </>
  );
}
