import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, LogOut, Menu, Moon, Sun, UserCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NotificationsBell } from "@/features/notifications";
import { useSession } from "@/lib/session";
import { useUiPrefs } from "@/lib/ui-prefs";
import { GlobalSearch } from "./GlobalSearch";
import { Logo } from "./Logo";

// Section 6.1: brand-500, 64px. [Fieldpiece | Warranty], search, notifications, account.

interface AppHeaderProps {
  onSignOut: () => void;
}

const iconButton =
  "flex h-11 w-11 items-center justify-center rounded text-header-text hover:bg-tint active:bg-tint-strong";

export function AppHeader({ onSignOut }: AppHeaderProps) {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const { theme, setTheme, setMobileNavOpen } = useUiPrefs();

  return (
    <header className="no-print flex h-header items-center gap-4 bg-header px-4 text-header-text md:px-6">
      <button
        type="button"
        className={`${iconButton} -ms-2 lg:hidden`}
        aria-label={t("header.openMenu")}
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu size={20} strokeWidth={1.75} aria-hidden />
      </button>

      <Logo />

      <div className="flex flex-1 justify-end md:justify-center">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={iconButton}
          aria-label={theme === "dark" ? t("header.theme.light") : t("header.theme.dark")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun size={20} strokeWidth={1.75} aria-hidden />
          ) : (
            <Moon size={20} strokeWidth={1.75} aria-hidden />
          )}
        </button>
        <NotificationsBell
          trigger={(unread) => (
            <button
              type="button"
              className={iconButton}
              aria-label={
                unread ? t("header.notificationsUnread", { count: unread }) : t("header.notifications")
              }
            >
              <Bell size={20} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={iconButton} aria-label={t("header.account")}>
            <UserCircle2 size={24} strokeWidth={1.75} aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-56 rounded border border-border bg-surface p-1 text-text shadow-overlay"
            >
              {user ? (
                <div className="px-3 py-2">
                  <p className="font-semibold">{user.name}</p>
                  <p className="text-sm text-text-muted">{t(`roles.${user.role}`)}</p>
                </div>
              ) : null}
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                onSelect={onSignOut}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-sm px-3 outline-none data-[highlighted]:bg-brand-50"
              >
                <LogOut size={16} strokeWidth={1.75} aria-hidden />
                {t("header.signOut")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
