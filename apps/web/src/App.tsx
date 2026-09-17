import { PersonasPage } from './pages/PersonasPage.js';
import { ResultatenPage } from './pages/ResultatenPage.js';
import { GeoPage as AiVisibilityPage } from './pages/GeoPage.js';
import { ContentStudioPage } from './pages/ContentStudioPage.js';
import { RadarPage } from './pages/RadarPage.js';
import { useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { LabelSummary, ModuleAvailability } from '@c360/contracts';
import { Card, Notice } from '@c360/ui';
import { useCurrentUser, useLabels, useWorkspace } from './api/queries.js';
import { AppShell } from './shell/AppShell.js';
import { LabelTheme } from './shell/LabelTheme.js';
import { BreadcrumbProvider, useTrail } from './shell/breadcrumbs.js';
import { KNOWLEDGE_NAV, PRIMARY_NAV } from './shell/navigation.js';
import { WerkruimtePage } from './pages/WerkruimtePage.js';
import { LabelsPage } from './pages/LabelsPage.js';
import { CampagnesPage } from './pages/CampagnesPage.js';
import { CampagneDetailPage } from './pages/CampagneDetailPage.js';
import { OpleidingenPage } from './pages/OpleidingenPage.js';
import { MerkPage } from './pages/MerkPage.js';
import { NietBeschikbaarPage } from './pages/NietBeschikbaarPage.js';
import { ErrorState } from './components/states.js';

const LABEL_STORAGE_KEY = 'c360.activeLabelId';

/**
 * Paths that have a real screen. Everything else falls through to the honest
 * "not available yet" placeholder, so a half-built area can never look ready.
 */
const IMPLEMENTED_ROUTES = new Set([
  '/werkruimte',
  '/kansen',
  '/radar',
  '/ai-visibility',
  '/campagnes',
  '/content',
  '/beheer/labels',
  '/beheer/opleidingen',
  '/beheer/merk',
  '/beheer/doelgroepen',
  '/resultaten',
]);

/** The shell and the routes, under the breadcrumb state the pages write to. */
export function App(): ReactNode {
  return (
    <BreadcrumbProvider>
      <AppInner />
    </BreadcrumbProvider>
  );
}

function AppInner(): ReactNode {
  const user = useCurrentUser();
  const labels = useLabels();
  const location = useLocation();

  // The user's *preference*, not the resolved label. Keeping it as a
  // preference means the active label is derived on every render and needs no
  // effect to stay in sync — a stored id the user no longer has access to
  // simply stops matching, so a revoked membership cannot leave a stale label
  // selected.
  const [preferredLabelId, setPreferredLabelId] = useState<string | undefined>(() =>
    readStoredLabel(),
  );

  // Memoised so the fallback `[]` is not a fresh array on every render, which
  // would invalidate the derived label each time.
  const items = useMemo(() => labels.data?.items ?? [], [labels.data]);

  const activeLabel = useMemo(
    () => items.find((label) => label.id === preferredLabelId) ?? defaultLabel(items),
    [items, preferredLabelId],
  );

  const workspace = useWorkspace(activeLabel?.id);
  const modules: readonly ModuleAvailability[] = workspace.data?.moduleAvailability ?? [];

  const breadcrumb = useTrail(location.pathname);

  if (user.isError) {
    return (
      <div className="c360-content">
        <ErrorState
          message={user.error.userMessage}
          requestId={user.error.requestId}
          onRetry={() => void user.refetch()}
        />
      </div>
    );
  }

  return (
    <LabelTheme label={activeLabel}>
      <AppShell
        user={user.data}
        labels={items}
        activeLabel={activeLabel}
        onLabelChange={(labelId) => {
          setPreferredLabelId(labelId);
          writeStoredLabel(labelId);
        }}
        modules={modules}
        breadcrumb={breadcrumb}
        showDemoFlag={workspace.data?.containsDemoData ?? false}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/werkruimte" replace />} />
          <Route path="/werkruimte" element={<WerkruimtePage label={activeLabel} />} />
          <Route path="/ai-visibility" element={<AiVisibilityPage label={activeLabel} />} />
          <Route path="/radar" element={<RadarPage label={activeLabel} />} />
          <Route path="/kansen" element={<Navigate to="/radar?tab=saved" replace />} />
          <Route path="/campagnes" element={<CampagnesPage label={activeLabel} />} />
          <Route path="/campagnes/:campaignId" element={<CampagneDetailPage label={activeLabel} />} />
          <Route path="/content" element={<ContentStudioPage label={activeLabel} />} />
          <Route path="/beheer/labels" element={<LabelsPage user={user.data} />} />
          <Route path="/beheer/opleidingen" element={<OpleidingenPage label={activeLabel} />} />
          <Route path="/beheer/doelgroepen" element={<PersonasPage label={activeLabel} />} />
          <Route path="/beheer/merk" element={<MerkPage label={activeLabel} />} />
          <Route path="/resultaten" element={<ResultatenPage label={activeLabel} />} />

          {/* Areas that are not built yet each get an honest placeholder rather
              than a screen that looks operational. */}
          {[...PRIMARY_NAV, ...KNOWLEDGE_NAV]
            .filter((item) => !IMPLEMENTED_ROUTES.has(item.path))
            .map((item) => (
              <Route
                key={item.path}
                path={item.path}
                element={
                  <NietBeschikbaarPage title={item.label} area={item.area} modules={modules} />
                }
              />
            ))}

          <Route
            path="*"
            element={
              <Card ariaLabel="Pagina niet gevonden">
                <Notice tone="warning">Deze pagina bestaat niet.</Notice>
              </Card>
            }
          />
        </Routes>
      </AppShell>
    </LabelTheme>
  );
}

/**
 * Which label to open when the user has expressed no preference.
 *
 * The switcher stays alphabetical because that is predictable to scan, but the
 * *default* is the label where the user carries the most responsibility. A
 * read-only label that merely happens to sort first is a poor place to land.
 */
const ROLE_PRECEDENCE: Record<LabelSummary['role'], number> = {
  label_manager: 0,
  label_approver: 1,
  label_editor: 2,
  label_viewer: 3,
};

function defaultLabel(labels: readonly LabelSummary[]): LabelSummary | undefined {
  return [...labels].sort(
    (a, b) =>
      ROLE_PRECEDENCE[a.role] - ROLE_PRECEDENCE[b.role] || a.name.localeCompare(b.name, 'nl'),
  )[0];
}

/**
 * The selected label is a per-browser convenience only. It is never a source of
 * authority: the server re-derives access from membership rows on every request.
 */
function readStoredLabel(): string | undefined {
  try {
    return window.localStorage.getItem(LABEL_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredLabel(labelId: string): void {
  try {
    window.localStorage.setItem(LABEL_STORAGE_KEY, labelId);
  } catch {
    // Private browsing or blocked site data: the app works without it.
  }
}
