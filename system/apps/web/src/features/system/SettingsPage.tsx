import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  Badge,
  Button,
  Card,
  cn,
  Field,
  Icon,
  Input,
  LookupSelect,
  PageHeader,
  Spinner,
  Switch,
  Tabs,
  Textarea,
  toast,
} from "@/components/ui";

interface Setting {
  key: string;
  group: string;
  label: string | null;
  description: string | null;
  /** string | number | boolean | text | secret | json | lookup:<CATEGORY> */
  valueType: string;
  isSecret: boolean;
  scope: "company" | "global";
  value: string | null;
  hasValue: boolean;
}

const GROUPS: Record<string, { label: string; icon: string }> = {
  general: { label: "General", icon: "settings" },
  clock: { label: "Clock", icon: "clock" },
  notifications: { label: "Notifications", icon: "bell" },
  security: { label: "Security", icon: "shield" },
  document: { label: "Documents", icon: "file-text" },
  sales: { label: "Sales", icon: "shopping-cart" },
  inventory: { label: "Inventory", icon: "boxes" },
  hris: { label: "HRIS", icon: "id-card" },
  accounting: { label: "Accounting", icon: "calculator" },
  approvals: { label: "Approvals", icon: "stamp" },
  helpdesk: { label: "Helpdesk", icon: "life-buoy" },
  files: { label: "Files", icon: "folder" },
  mail: { label: "E-mail", icon: "mail" },
  website: { label: "Website", icon: "globe" },
  marketing: { label: "Marketing", icon: "megaphone" },
  obligations: { label: "Obligations", icon: "calendar-clock" },
  tax: { label: "Tax", icon: "landmark" },
  payroll: { label: "Payroll & BPJS", icon: "wallet" },
  privacy: { label: "Privacy (UU PDP)", icon: "user-lock" },
  integration: { label: "Integrations", icon: "plug" },
};

/** Groups shown as titled blocks in a fixed order (related settings together instead of alphabetical) */
const SECTIONS: Record<string, { title: string; keys: string[] }[]> = {
  website: [
    {
      title: "Home page",
      keys: [
        "website.heroBadge",
        "website.heroTitle",
        "website.heroSubtitle",
        "website.heroTyping",
        "website.ctaText",
        "website.announcement",
      ],
    },
    {
      title: "Contact",
      keys: [
        "website.whatsapp",
        "website.phone",
        "website.email",
        "website.address",
        "website.hours",
        "website.mapsUrl",
        "website.mapsEmbedUrl",
      ],
    },
    {
      title: "Social media",
      keys: [
        "website.instagram",
        "website.linkedin",
        "website.facebook",
        "website.tiktok",
        "website.youtube",
      ],
    },
    {
      title: "Sections & enquiries",
      keys: ["website.hiddenSections", "website.enquiryOwner"],
    },
  ],
};
const sectionOf = (group: string, key: string) => {
  const list = SECTIONS[group];
  if (!list) return null;
  const i = list.findIndex((x) => x.keys.includes(key));
  return i < 0
    ? { i: list.length, title: "Other", at: 0 }
    : { i, title: list[i].title, at: list[i].keys.indexOf(key) };
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { can, me, reload } = useSession();
  const [sp, setSp] = useSearchParams();
  const settings = useQuery({
    queryKey: ["system", "settings"],
    queryFn: () => api.get<Setting[]>("/system/settings"),
  });
  const groups = useMemo(() => {
    const present = new Set((settings.data ?? []).map((s) => s.group));
    return [
      ...Object.keys(GROUPS).filter((g) => present.has(g)),
      ...[...present].filter((g) => !GROUPS[g]),
    ];
  }, [settings.data]);
  const tab =
    sp.get("tab") && groups.includes(sp.get("tab")!)
      ? sp.get("tab")!
      : groups[0];
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"company" | "global">("company");
  const [busy, setBusy] = useState(false);
  const editable = can("system.setting.update");

  useEffect(() => {
    if (settings.data) {
      setValues(
        Object.fromEntries(
          settings.data.map((s) => [s.key, s.isSecret ? "" : (s.value ?? "")]),
        ),
      );
      setDirty(new Set());
    }
  }, [settings.data]);

  const term = search.trim().toLowerCase();
  // searching looks through every group; otherwise the selected group is shown
  const items = (settings.data ?? []).filter((s) =>
    term
      ? `${s.label ?? ""} ${s.description ?? ""} ${s.key}`
          .toLowerCase()
          .includes(term)
      : s.group === tab,
  );
  if (!term && SECTIONS[tab]) {
    const pos = (k: string) => sectionOf(tab, k)!;
    items.sort(
      (a, b) => pos(a.key).i - pos(b.key).i || pos(a.key).at - pos(b.key).at,
    );
  }
  const dirtyIn = (g: string) =>
    (settings.data ?? []).some((s) => s.group === g && dirty.has(s.key));

  // unsaved changes survive switching groups; warn before leaving the page
  useEffect(() => {
    if (!dirty.size) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const change = (key: string, v: string) => {
    setValues((s) => ({ ...s, [key]: v }));
    setDirty((d) => new Set([...d, key]));
  };
  const save = async () => {
    // saves every changed setting, in all groups
    const changed = (settings.data ?? []).filter(
      (s) => dirty.has(s.key) && !(s.isSecret && !values[s.key]),
    );
    if (!changed.length) return toast.info("Nothing to save");
    setBusy(true);
    try {
      await api.put("/system/settings", {
        values: changed.map((s) => ({
          key: s.key,
          value: values[s.key] === "" ? null : values[s.key],
          scope,
        })),
      });
      toast.success(
        `${changed.length} setting${changed.length > 1 ? "s" : ""} saved`,
      );
      // clear what was saved right away: a secret is never sent back, so the reloaded list can be identical
      // to the previous one and would not reset the form on its own
      const savedKeys = new Set(changed.map((s) => s.key));
      setDirty((d) => new Set([...d].filter((k) => !savedKeys.has(k))));
      setValues((v) => ({
        ...v,
        ...Object.fromEntries(
          changed.filter((s) => s.isSecret).map((s) => [s.key, ""]),
        ),
      }));
      await qc.invalidateQueries({ queryKey: ["system", "settings"] });
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (!settings.data) return;
    setValues(
      Object.fromEntries(
        settings.data.map((s) => [s.key, s.isSecret ? "" : (s.value ?? "")]),
      ),
    );
    setDirty(new Set());
  };
  const groupLabel = (g: string) =>
    GROUPS[g]?.label ?? g.charAt(0).toUpperCase() + g.slice(1);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Settings"
        subtitle="All business configuration lives here - nothing is hardcoded"
      />
      {settings.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_1fr] [&>*]:min-w-0">
          <aside className="space-y-3">
            <div className="relative">
              <Icon
                name="search"
                className="absolute top-2.5 left-3 h-4 w-4 text-slate-400"
              />
              <Input
                className="pl-9"
                placeholder="Find a setting..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Find a setting"
              />
            </div>
            <div className="lg:hidden">
              <Tabs
                value={tab}
                onChange={(t) => {
                  setSearch("");
                  setSp({ tab: t }, { replace: true });
                }}
                tabs={groups.map((g) => ({
                  value: g,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name={GROUPS[g]?.icon ?? "settings"} />
                      {groupLabel(g)}
                      {dirtyIn(g) && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      )}
                    </span>
                  ),
                }))}
              />
            </div>
            <nav
              className="hidden space-y-0.5 lg:block"
              aria-label="Setting groups"
            >
              {groups.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSp({ tab: g }, { replace: true });
                  }}
                  aria-current={!term && tab === g ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    !term && tab === g
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Icon
                    name={GROUPS[g]?.icon ?? "settings"}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="flex-1 truncate">{groupLabel(g)}</span>
                  {dirtyIn(g) && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-500"
                      title="Unsaved changes"
                    />
                  )}
                </button>
              ))}
            </nav>
          </aside>
          <div className="min-w-0">
            <Card
              className="mb-4"
              actions={
                editable && (
                  <>
                    {me?.user.isSuperAdmin && (
                      <div
                        className="inline-flex rounded-lg border border-line bg-slate-50 p-0.5 text-xs"
                        role="radiogroup"
                        aria-label="Save scope"
                      >
                        {(["company", "global"] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={scope === v}
                            onClick={() => setScope(v)}
                            className={cn(
                              "rounded-md px-2.5 py-1 font-medium transition-colors",
                              scope === v
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-800",
                            )}
                          >
                            {v === "company"
                              ? `This company`
                              : "Global default"}
                          </button>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      icon="save"
                      loading={busy}
                      onClick={save}
                      disabled={!dirty.size}
                    >
                      {dirty.size
                        ? `Save ${dirty.size} change${dirty.size > 1 ? "s" : ""}`
                        : "Save"}
                    </Button>
                  </>
                )
              }
              title={term ? `Results for "${search.trim()}"` : groupLabel(tab)}
            >
              {items.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">
                  No setting matches your search.
                </p>
              )}
              <div className="divide-y divide-line">
                {items.map((s, idx) => (
                  <Fragment key={s.key}>
                    {!term &&
                      sectionOf(s.group, s.key) &&
                      (idx === 0 ||
                        sectionOf(s.group, items[idx - 1].key)!.i !==
                          sectionOf(s.group, s.key)!.i) && (
                        <h4 className="!border-t-0 pt-5 pb-1 text-xs font-semibold tracking-wide text-brand-700 uppercase first:pt-0">
                          {sectionOf(s.group, s.key)!.title}
                        </h4>
                      )}
                    <div className="grid grid-cols-1 gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_1.3fr] sm:gap-6">
                      <div>
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {s.label ?? s.key}
                          {term && <Badge>{groupLabel(s.group)}</Badge>}
                          {dirty.has(s.key) && (
                            <Badge tone="amber">Changed</Badge>
                          )}
                          {s.scope === "company" && (
                            <Badge tone="blue">Company</Badge>
                          )}
                          {s.isSecret && (
                            <Icon
                              name="lock"
                              className="h-3.5 w-3.5 text-emerald-600"
                            />
                          )}
                        </p>
                        {s.description && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {s.description}
                          </p>
                        )}
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          {s.key}
                        </p>
                      </div>
                      <div>
                        {s.valueType.startsWith("lookup:") ? (
                          <LookupSelect
                            category={s.valueType.slice(7)}
                            value={values[s.key] ?? ""}
                            disabled={!editable}
                            onChange={(v) => change(s.key, v)}
                            aria-label={s.label ?? s.key}
                          />
                        ) : s.valueType === "boolean" ? (
                          <Switch
                            checked={values[s.key] === "true"}
                            disabled={!editable}
                            onChange={(v) => change(s.key, String(v))}
                          />
                        ) : s.valueType === "text" || s.valueType === "json" ? (
                          <Textarea
                            rows={4}
                            value={values[s.key] ?? ""}
                            disabled={!editable}
                            onChange={(e) => change(s.key, e.target.value)}
                            className={
                              s.valueType === "json"
                                ? "font-mono text-xs"
                                : undefined
                            }
                          />
                        ) : s.isSecret ? (
                          <Field
                            help={
                              s.hasValue
                                ? "A value is stored (encrypted). Type a new value to replace it."
                                : "Not configured yet."
                            }
                          >
                            <div className="flex items-center gap-2">
                              <Input
                                type="password"
                                autoComplete="new-password"
                                placeholder={
                                  s.hasValue ? "••••••••••••" : "Enter value"
                                }
                                value={values[s.key] ?? ""}
                                disabled={!editable}
                                onChange={(e) => change(s.key, e.target.value)}
                              />
                              {s.hasValue ? (
                                <Badge tone="green">Configured</Badge>
                              ) : (
                                <Badge tone="amber">Not set</Badge>
                              )}
                            </div>
                          </Field>
                        ) : s.key === "document.primaryColor" ? (
                          <div className="flex gap-2">
                            <input
                              type="color"
                              className="h-10 w-12 cursor-pointer rounded-lg border border-line"
                              value={
                                /^#[0-9a-f]{6}$/i.test(values[s.key] ?? "")
                                  ? values[s.key]
                                  : "#1d4f7a"
                              }
                              disabled={!editable}
                              onChange={(e) => change(s.key, e.target.value)}
                            />
                            <Input
                              value={values[s.key] ?? ""}
                              disabled={!editable}
                              onChange={(e) => change(s.key, e.target.value)}
                            />
                          </div>
                        ) : (
                          <Input
                            type={
                              s.valueType === "number"
                                ? "number"
                                : /Time$/.test(s.key)
                                  ? "time"
                                  : "text"
                            }
                            className={
                              s.valueType === "number"
                                ? "max-w-40 text-right tabular-nums"
                                : /Time$/.test(s.key)
                                  ? "max-w-40"
                                  : undefined
                            }
                            value={values[s.key] ?? ""}
                            disabled={!editable}
                            onChange={(e) => change(s.key, e.target.value)}
                          />
                        )}
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </Card>
            {tab === "mail" && !term && editable && (
              <TestMail disabled={dirty.size > 0} />
            )}
            {tab === "document" && !term && <CompanyLogo editable={editable} />}
            {dirty.size > 0 && editable && (
              <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm shadow-pop backdrop-blur">
                <Icon name="circle-alert" className="h-4 w-4 text-amber-600" />
                <span className="mr-auto text-amber-800">
                  {dirty.size} unsaved change{dirty.size > 1 ? "s" : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={discard}
                  disabled={busy}
                >
                  Discard
                </Button>
                <Button size="sm" icon="save" loading={busy} onClick={save}>
                  Save changes
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Sends a test message with the saved SMTP settings */
function TestMail({ disabled }: { disabled: boolean }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post("/system/settings/test-mail", { to: to.trim() });
      toast.success(`Test e-mail sent to ${to.trim()}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Send a test e-mail"
      subtitle={
        disabled
          ? "Save your changes first - the test uses the saved settings"
          : "Checks the saved SMTP settings by sending a short message"
      }
    >
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (to.trim()) send();
        }}
      >
        <Input
          type="email"
          placeholder="name@example.com"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Send the test e-mail to"
          className="sm:max-w-sm"
        />
        <Button
          type="submit"
          icon="send"
          loading={busy}
          disabled={disabled || !to.trim()}
        >
          Send test e-mail
        </Button>
      </form>
    </Card>
  );
}

interface CompanyLogoData {
  logo: { fileId: string; name: string; size: number; dataUrl: string } | null;
}

/** Logo on the letterhead of every document PDF (PNG or JPG; without one the company initials are shown) */
function CompanyLogo({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const q = useQuery({
    queryKey: ["company-logo"],
    queryFn: () => api.get<CompanyLogoData>("/system/settings/company-logo"),
  });
  const logo = q.data?.logo ?? null;

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      toast.error(
        "Use a PNG or JPG image. Documents cannot show SVG, WebP or other formats.",
      );
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("The image is larger than 2 MB");
      return;
    }
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      qc.setQueryData(
        ["company-logo"],
        await api.post<CompanyLogoData>("/system/settings/company-logo", fd),
      );
      toast.success("Logo saved. New PDFs use it right away.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy("remove");
    try {
      qc.setQueryData(
        ["company-logo"],
        await api.delete<CompanyLogoData>("/system/settings/company-logo"),
      );
      toast.success("Logo removed. Documents show the company initials.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Company logo"
      subtitle="Shown next to the company name on every document PDF"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-[length:16px_16px]">
          {q.isLoading ? (
            <Spinner className="h-5 w-5 text-slate-400" />
          ) : logo ? (
            <img
              src={logo.dataUrl}
              alt="Company logo"
              className="max-h-20 max-w-20 object-contain"
            />
          ) : (
            <Icon name="image" className="h-8 w-8 text-slate-300" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-slate-600">
            {logo ? (
              <>
                <span className="font-medium text-slate-800">{logo.name}</span>{" "}
                · {Math.max(1, Math.round(logo.size / 1024))} KB
              </>
            ) : (
              "No logo yet: documents show the company initials."
            )}
          </p>
          <p className="text-xs text-slate-500">
            PNG (transparent background works best) or JPG, at most 2 MB. A
            square image of about 256 × 256 pixels looks sharp.
          </p>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => upload(e.target.files)}
                aria-label="Choose a logo image"
              />
              <Button
                size="sm"
                icon="upload"
                loading={busy === "upload"}
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                {logo ? "Change logo" : "Upload logo"}
              </Button>
              {logo && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash-2"
                  loading={busy === "remove"}
                  disabled={!!busy}
                  onClick={remove}
                >
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
