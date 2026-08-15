"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import clsx from "clsx";
import {
  BookOpen,
  Boxes,
  FolderKanban,
  GitBranch,
  Library,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Activity,
  Settings,
  Trash2,
} from "lucide-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { graphPath, queryChatPath } from "@/lib/paths";
import { mapPath } from "@/lib/systemMap";
import { GraphCreateModal } from "@/components/GraphCreateModal";
import { DeletingState, LoadingState } from "@/components/LoadingState";

type CreateCtx = {
  openCreate: () => void;
};

const CreateModalContext = createContext<CreateCtx | null>(null);
const SIDEBAR_KEY = "haywire.sidebar.collapsed";

export function useCreateGraphModal() {
  const ctx = useContext(CreateModalContext);
  if (!ctx) {
    throw new Error("useCreateGraphModal must be used within DashboardShell");
  }
  return ctx;
}

function initialsFrom(name?: string | null, email?: string | null) {
  const source = (name || email || "U").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function UserAvatar({
  image,
  name,
  email,
  size = 36,
}: {
  image?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
}) {
  const initials = initialsFrom(name, email);
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover ring-1 ring-black/5"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="grid place-items-center rounded-full bg-gradient-to-br from-[#14b8a6] to-[#0f766e] text-[11px] font-semibold tracking-wide text-white shadow-sm ring-1 ring-black/5"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const saved = useQuery(api.graphs.listMine, isAuthenticated ? {} : "skip") ?? [];
  const chats = useQuery(api.chats.listMine, isAuthenticated ? {} : "skip") ?? [];
  const maps = useQuery(api.maps.listMine, isAuthenticated ? {} : "skip") ?? [];
  const [modalOpen, setModalOpen] = useState(false);
  const [graphsOpen, setGraphsOpen] = useState(true);
  const [queryOpen, setQueryOpen] = useState(true);
  const [mapsOpen, setMapsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  // Optimistic navigation target: highlights the clicked item immediately,
  // even while the destination route is still loading.
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const removeGraph = useMutation(api.graphs.remove);
  const removeChat = useMutation(api.chats.remove);
  const removeMap = useMutation(api.maps.remove);
  const [pendingDelete, setPendingDelete] = useState<
    | { type: "graph"; id: Id<"savedGraphs">; label: string; owner: string; repo: string }
    | { type: "chat"; id: Id<"queryChats">; label: string }
    | { type: "map"; id: Id<"systemMaps">; label: string; owner: string; repo: string }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!pendingDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) setPendingDelete(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete, deleting]);

  useEffect(() => {
    setPendingPath(null);
  }, [pathname]);

  const navigate = useCallback(
    (path: string) => {
      setPendingPath(path);
      router.push(path);
    },
    [router],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const openCreate = useCallback(() => setModalOpen(true), []);
  const ctx = useMemo(() => ({ openCreate }), [openCreate]);

  const displayName =
    viewer?.name?.trim() || viewer?.email?.split("@")[0] || "Account";
  const email = viewer?.email || "";
  const image =
    typeof (viewer as { image?: string } | null | undefined)?.image === "string"
      ? (viewer as { image?: string }).image
      : null;

  // Use the pending (clicked) path when navigating so the sidebar highlight
  // updates instantly instead of waiting for the new page to render.
  const currentPath = pendingPath ?? pathname;

  const graphMatch = currentPath.match(/^\/dashboard\/graph\/([^/]+)\/([^/]+)/);
  const activeOwner = graphMatch ? decodeURIComponent(graphMatch[1]) : null;
  const activeRepo = graphMatch ? decodeURIComponent(graphMatch[2]) : null;
  const onGraphPage = Boolean(activeOwner && activeRepo);
  const onGraphsHome = currentPath === "/dashboard";
  const mapMatch = currentPath.match(/^\/dashboard\/map\/([^/]+)\/([^/]+)/);
  const activeMapOwner = mapMatch ? decodeURIComponent(mapMatch[1]) : null;
  const activeMapRepo = mapMatch ? decodeURIComponent(mapMatch[2]) : null;
  const onMapPage = Boolean(activeMapOwner && activeMapRepo);
  const onMapHome = currentPath === "/dashboard/map";
  const onMap = onMapHome || onMapPage;
  const onUsage = currentPath.startsWith("/dashboard/usage");
  const onGuidance = currentPath.startsWith("/dashboard/guidance");
  const chatMatch = currentPath.match(/^\/dashboard\/query\/([^/]+)/);
  const activeChatId = chatMatch ? decodeURIComponent(chatMatch[1]) : null;
  const onQueryPage = currentPath === "/dashboard/query";
  const onQueryChat = Boolean(activeChatId);
  const onQuery =
    currentPath.startsWith("/dashboard/query") ||
    currentPath.startsWith("/dashboard/browse") ||
    currentPath.startsWith("/browse");

  // Keep the nested list open while viewing a graph / chat
  useEffect(() => {
    if (onGraphPage) setGraphsOpen(true);
  }, [onGraphPage]);
  useEffect(() => {
    if (onQueryChat) setQueryOpen(true);
  }, [onQueryChat]);
  useEffect(() => {
    if (onMapPage) setMapsOpen(true);
  }, [onMapPage]);

  const sidebarGraphs = useMemo(() => {
    const items = saved.map((g) => ({
      key: `${g.owner}/${g.repo}`,
      id: g._id as Id<"savedGraphs"> | null,
      owner: g.owner,
      repo: g.repo,
      label: g.label || g.repo,
    }));
    if (
      activeOwner &&
      activeRepo &&
      !items.some((g) => g.owner === activeOwner && g.repo === activeRepo)
    ) {
      items.unshift({
        key: `${activeOwner}/${activeRepo}`,
        id: null,
        owner: activeOwner,
        repo: activeRepo,
        label: activeRepo,
      });
    }
    return items.slice(0, 12);
  }, [saved, activeOwner, activeRepo]);

  const sidebarMaps = useMemo(() => {
    const items = maps.map((m) => ({
      key: `${m.owner}/${m.repo}`,
      id: m._id as Id<"systemMaps"> | null,
      owner: m.owner,
      repo: m.repo,
      label: m.label || m.repo,
      thumbnailUrl: m.thumbnailUrl,
    }));
    if (
      activeMapOwner &&
      activeMapRepo &&
      !items.some((m) => m.owner === activeMapOwner && m.repo === activeMapRepo)
    ) {
      items.unshift({
        key: `${activeMapOwner}/${activeMapRepo}`,
        id: null,
        owner: activeMapOwner,
        repo: activeMapRepo,
        label: activeMapRepo,
        thumbnailUrl: null,
      });
    }
    return items.slice(0, 12);
  }, [maps, activeMapOwner, activeMapRepo]);

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      if (pendingDelete.type === "graph") {
        await removeGraph({ id: pendingDelete.id });
        if (activeOwner === pendingDelete.owner && activeRepo === pendingDelete.repo) {
          navigate("/dashboard");
        }
      } else if (pendingDelete.type === "chat") {
        await removeChat({ chatId: pendingDelete.id });
        if (activeChatId === pendingDelete.id) {
          navigate("/dashboard/query");
        }
      } else {
        await removeMap({ id: pendingDelete.id });
        if (activeMapOwner === pendingDelete.owner && activeMapRepo === pendingDelete.repo) {
          navigate("/dashboard/map");
        }
      }
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  function handleGraphsClick(e: React.MouseEvent) {
    if (collapsed || sidebarGraphs.length === 0) {
      navigate("/dashboard");
      return;
    }
    // Toggle nested list when Graphs is clicked; still go home if not already there
    e.preventDefault();
    if (!onGraphsHome && !onGraphPage) {
      setGraphsOpen(true);
      navigate("/dashboard");
      return;
    }
    setGraphsOpen((o) => !o);
    if (!onGraphsHome) navigate("/dashboard");
  }

  function handleQueryClick(e: React.MouseEvent) {
    if (collapsed || chats.length === 0) {
      navigate("/dashboard/query");
      return;
    }
    e.preventDefault();
    if (!onQueryPage && !onQueryChat) {
      setQueryOpen(true);
      navigate("/dashboard/query");
      return;
    }
    setQueryOpen((o) => !o);
    if (!onQueryPage) navigate("/dashboard/query");
  }

  function handleMapClick(e: React.MouseEvent) {
    if (collapsed || sidebarMaps.length === 0) {
      navigate("/dashboard/map");
      return;
    }
    e.preventDefault();
    if (!onMapHome && !onMapPage) {
      setMapsOpen(true);
      navigate("/dashboard/map");
      return;
    }
    setMapsOpen((o) => !o);
    if (!onMapHome) navigate("/dashboard/map");
  }

  const sidebarChats = chats.slice(0, 12);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <LoadingState />
      </div>
    );
  }

  const navItemClass = (active: boolean) =>
    clsx(
      "flex items-center rounded-lg text-sm",
      "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
      collapsed ? "justify-center gap-0 px-0 py-2.5" : "gap-2.5 px-2.5 py-2",
      active
        ? "bg-black/[0.06] font-semibold text-wire-ink"
        : "font-medium text-wire-mute hover:bg-black/[0.04] hover:text-wire-ink",
    );

  // Labels stay mounted and animate their width so collapsing feels seamless
  // instead of text popping in and out.
  const navLabelClass = clsx(
    "truncate overflow-hidden whitespace-nowrap",
    "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
    collapsed ? "max-w-0 opacity-0" : "max-w-[9.5rem] opacity-100",
  );

  return (
    <CreateModalContext.Provider value={ctx}>
      <div className="flex h-screen overflow-hidden bg-white text-wire-ink">
        <aside
          className={clsx(
            "group/aside flex shrink-0 flex-col overflow-hidden border-r border-black/[0.06] bg-white",
            "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            collapsed ? "w-[4.25rem]" : "w-[15.5rem]",
          )}
        >
          <div
            className={clsx(
              "pb-3 pt-4 transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              collapsed ? "px-2" : "px-3",
            )}
          >
            <div
              className={clsx(
                "flex items-center transition-all duration-300",
                collapsed ? "justify-center" : "justify-between gap-2",
              )}
            >
              {collapsed ? (
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                  className="grid h-9 w-9 animate-fade-in place-items-center rounded-lg text-wire-mute transition-colors hover:bg-black/[0.04] hover:text-wire-ink"
                >
                  {/* Logo swaps to the expand glyph when hovering the rail. */}
                  <span className="relative grid h-4 w-4 place-items-center">
                    <Image
                      src="/icon.svg"
                      alt="Haywire"
                      width={16}
                      height={16}
                      unoptimized
                      className="h-4 w-4 object-contain transition-opacity duration-150 group-hover/aside:opacity-0"
                    />
                    <PanelLeftOpen
                      className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity duration-150 group-hover/aside:opacity-100"
                      strokeWidth={1.75}
                    />
                  </span>
                </button>
              ) : (
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setPendingPath("/dashboard")}
                    className="flex min-w-0 animate-fade-in items-center px-1 py-1 outline-none"
                    title="Haywire"
                  >
                    <Image
                      src="/logo.svg"
                      alt="Haywire"
                      width={200}
                      height={52}
                      unoptimized
                      priority
                      className="h-12 w-auto max-w-[12.5rem] object-contain object-left sm:h-[3.25rem] sm:max-w-[13rem]"
                    />
                  </Link>

                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label="Collapse sidebar"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-wire-mute transition-colors duration-200 hover:bg-black/[0.04] hover:text-wire-ink"
                  >
                    <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={openCreate}
              title="Create"
              className={clsx(
                "mt-3 flex items-center justify-center bg-[#0b0d10] text-[13px] font-medium text-white hover:bg-black",
                "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                collapsed
                  ? "mx-auto h-9 w-9 gap-0 rounded-lg"
                  : "w-full gap-1.5 rounded-lg px-3 py-2",
              )}
            >
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span
                className={clsx(
                  "overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                  collapsed ? "max-w-0 opacity-0" : "max-w-[6rem] opacity-100",
                )}
              >
                Create
              </span>
            </button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
            <button
              type="button"
              title="Graphs"
              onClick={handleGraphsClick}
              className={clsx(navItemClass(onGraphsHome || onGraphPage), "w-full text-left")}
            >
              <FolderKanban className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className={navLabelClass}>Graphs</span>
            </button>

            <div
              className={clsx(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                !collapsed && graphsOpen && sidebarGraphs.length > 0
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <ul className="mb-2 ml-2 space-y-0.5 border-l border-black/8 pl-2">
                  {sidebarGraphs.map((g) => {
                    const active = g.owner === activeOwner && g.repo === activeRepo;
                    return (
                      <li key={g.key} className="group/item relative">
                        <Link
                          href={graphPath(g.owner, g.repo)}
                          onClick={() => setPendingPath(graphPath(g.owner, g.repo))}
                          className={clsx(
                            "flex items-center gap-2 truncate rounded-md px-2 py-1.5 pr-7 text-sm transition-colors",
                            active
                              ? "bg-[#f4f4f5] font-semibold text-wire-ink"
                              : "text-wire-mute hover:bg-black/[0.04] hover:text-wire-ink",
                          )}
                          title={`${g.owner}/${g.repo}`}
                        >
                          <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          <span className="truncate">{g.label}</span>
                        </Link>
                        {g.id ? (
                          <button
                            type="button"
                            aria-label={`Delete ${g.label}`}
                            title="Delete graph"
                            onClick={() =>
                              setPendingDelete({
                                type: "graph",
                                id: g.id!,
                                label: g.label,
                                owner: g.owner,
                                repo: g.repo,
                              })
                            }
                            className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-wire-mute opacity-0 transition hover:bg-black/[0.06] hover:text-wire-ember focus-visible:opacity-100 group-hover/item:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <button
              type="button"
              title="Query"
              onClick={handleQueryClick}
              className={clsx(navItemClass(onQuery), "w-full text-left")}
            >
              <Library className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className={navLabelClass}>Query</span>
            </button>

            <div
              className={clsx(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                !collapsed && queryOpen && sidebarChats.length > 0
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <ul className="mb-2 ml-2 space-y-0.5 border-l border-black/8 pl-2">
                  {sidebarChats.map((c) => {
                    const active = c._id === activeChatId;
                    return (
                      <li key={c._id} className="group/item relative">
                        <Link
                          href={queryChatPath(c._id)}
                          onClick={() => setPendingPath(queryChatPath(c._id))}
                          className={clsx(
                            "flex items-center gap-2 truncate rounded-md px-2 py-1.5 pr-7 text-sm transition-colors",
                            active
                              ? "bg-[#f4f4f5] font-semibold text-wire-ink"
                              : "text-wire-mute hover:bg-black/[0.04] hover:text-wire-ink",
                          )}
                          title={c.title}
                        >
                          <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          <span className="truncate">{c.title}</span>
                        </Link>
                        <button
                          type="button"
                          aria-label={`Delete ${c.title}`}
                          title="Delete chat"
                          onClick={() =>
                            setPendingDelete({ type: "chat", id: c._id, label: c.title })
                          }
                          className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-wire-mute opacity-0 transition hover:bg-black/[0.06] hover:text-wire-ember focus-visible:opacity-100 group-hover/item:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <button
              type="button"
              title="Map"
              onClick={handleMapClick}
              className={clsx(navItemClass(onMap), "w-full text-left")}
            >
              <Boxes className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className={navLabelClass}>Map</span>
            </button>

            <div
              className={clsx(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                !collapsed && mapsOpen && sidebarMaps.length > 0
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <ul className="mb-2 ml-2 space-y-0.5 border-l border-black/8 pl-2">
                  {sidebarMaps.map((m) => {
                    const active = m.owner === activeMapOwner && m.repo === activeMapRepo;
                    const href = mapPath(m.owner, m.repo);
                    return (
                      <li key={m.key} className="group/item relative">
                        <Link
                          href={href}
                          onClick={() => setPendingPath(href)}
                          className={clsx(
                            "flex items-center gap-2 truncate rounded-md px-2 py-1.5 pr-7 text-sm transition-colors",
                            active
                              ? "bg-[#f4f4f5] font-semibold text-wire-ink"
                              : "text-wire-mute hover:bg-black/[0.04] hover:text-wire-ink",
                          )}
                          title={`${m.owner}/${m.repo}`}
                        >
                          {m.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.thumbnailUrl}
                              alt=""
                              className="h-5 w-7 shrink-0 rounded-[3px] bg-[#f3f4f6] object-cover ring-1 ring-black/10"
                            />
                          ) : (
                            <Boxes className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          )}
                          <span className="truncate">{m.label}</span>
                        </Link>
                        {m.id ? (
                          <button
                            type="button"
                            aria-label={`Delete ${m.label}`}
                            title="Delete map"
                            onClick={() =>
                              setPendingDelete({
                                type: "map",
                                id: m.id!,
                                label: m.label,
                                owner: m.owner,
                                repo: m.repo,
                              })
                            }
                            className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-wire-mute opacity-0 transition hover:bg-black/[0.06] hover:text-wire-ember focus-visible:opacity-100 group-hover/item:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <Link
              href="/dashboard/usage"
              title="Usage"
              onClick={() => setPendingPath("/dashboard/usage")}
              className={navItemClass(onUsage)}
            >
              <Activity className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className={navLabelClass}>Usage</span>
            </Link>

            <Link
              href="/dashboard/guidance"
              title="Guidance"
              onClick={() => setPendingPath("/dashboard/guidance")}
              className={navItemClass(onGuidance)}
            >
              <BookOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className={navLabelClass}>Guidance</span>
            </Link>
          </nav>

          <div className="mt-auto px-3 py-3">
            {collapsed ? (
              <div className="flex justify-center" title={email || displayName}>
                <UserAvatar image={image} name={viewer?.name} email={email} size={32} />
              </div>
            ) : (
              <div
                className="flex items-center gap-2.5 px-1 py-1"
                title={email || displayName}
              >
                <UserAvatar image={image} name={viewer?.name} email={email} size={32} />
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-wire-ink">
                  {displayName}
                </div>
                <Link
                  href="/dashboard/usage"
                  title="Settings"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-wire-mute transition-colors hover:bg-black/[0.04] hover:text-wire-ink"
                >
                  <Settings className="h-4 w-4" strokeWidth={1.75} />
                </Link>
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>

      <GraphCreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(owner, repo) => router.push(graphPath(owner, repo))}
      />

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => {
              if (!deleting) setPendingDelete(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-black/10 bg-white p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
          >
            <h2 className="font-display text-lg font-bold tracking-tight text-wire-ink">
              Delete {pendingDelete.type === "graph" ? "graph" : pendingDelete.type === "chat" ? "chat" : "map"}?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-wire-mute">
              <span className="font-medium text-wire-ink">“{pendingDelete.label}”</span>{" "}
              will be permanently deleted. This can’t be undone.
            </p>
            <div className="mt-5 flex min-h-[38px] items-center justify-end gap-2">
              {deleting ? (
                <div className="flex w-full justify-center py-0.5">
                  <DeletingState />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    className="rounded-lg border border-black/10 px-3.5 py-2 text-sm font-medium text-wire-ink transition hover:bg-black/[0.03]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmDelete()}
                    className="rounded-lg bg-[#dc2626] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#b91c1c]"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </CreateModalContext.Provider>
  );
}
