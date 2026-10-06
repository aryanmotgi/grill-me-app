import { DNAPage } from "./DNAPage";
import { ShipPage } from "./ShipPage";
import { useApp } from "../store";
import type { Teammate } from "../types";
import { DragHandle } from "./DragHandle";
import { SessionPane } from "./SessionPane";
import { TaskBoard } from "./TaskBoard";
import { Inbox } from "./Inbox";
import { ActivityTimeline } from "./ActivityTimeline";
import { QuickSwitcher } from "./QuickSwitcher";
import { Toasts } from "./Chrome";
import { SettingsModal } from "./Settings";
import { ProjectPicker } from "./ProjectPicker";
import { Onboarding } from "./Onboarding";
import { InstallConsent } from "./InstallConsent";
import { FlowPage } from "./FlowPage";
import { ReviewModal } from "./ReviewModal";
import { SessionHandoff } from "./SessionHandoff";
import { HomeDashboard } from "./HomeDashboard";
import { ErrorBoundary } from "./ErrorBoundary";
import { SimpleOverview } from "./simple/SimpleOverview";
import { lazy, Suspense } from "react";
// three.js and the 3D map load only when Code Space is opened
const SpacePage = lazy(() => import("../space/SpacePage").then((m) => ({ default: m.SpacePage })));
import { SimpleBrain } from "./simple/SimpleBrain";
import { uiLayoutOf } from "../lib/uiLayout";
import { FeatureIndex } from "./FeatureIndex";
import { DiffBoard } from "./DiffBoard";
import { PrDashboard } from "./PrDashboard";
import { CrossSessionSearch } from "./CrossSessionSearch";
import { SessionScrubber } from "./SessionScrubber";
import { PresenceMap } from "./PresenceMap";
import { KanbanBoard } from "./KanbanBoard";
import { TokenDashboard } from "./TokenDashboard";
import { BranchGraph } from "./BranchGraph";
import { StandupSummary } from "./StandupSummary";
import { MergeConductor } from "./MergeConductor";
import { ReleaseNotes } from "./ReleaseNotes";
import { Broadcast } from "./Broadcast";
import { WatchSession } from "./WatchSession";
import { SnippetLibrary } from "./SnippetLibrary";
import { DecisionsLog } from "./DecisionsLog";
import { Cheatsheet } from "./Cheatsheet";
import { CheckpointRunner } from "./CheckpointRunner";
import { SessionTemplates } from "./SessionTemplates";
import { NewSession } from "./NewSession";
import { BrainPage } from "./BrainPage";
import { AutomationsPage } from "./Automations";
import { Kickoff } from "./Kickoff";
import { ShipQueue } from "./ShipQueue";
import { PreviewPage } from "./PreviewPage";
import { BridgePanel } from "./BridgePanel";
import { TeamView } from "./TeamView";
import { TeammatesPage } from "./TeammatesPage";
import { MergeSessions } from "./MergeSessions";

/** What fills the middle: the active session (optionally split), the
 *  new-session screen, or a page opened from the nav/⌘K. Shared by both
 *  layouts so every "go to X" lands somewhere in either one. */
export function CenterStage({ active, split }: { active: Teammate | undefined; split: Teammate | undefined }) {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  return (
    <ErrorBoundary resetKey={`${view}:${active?.id ?? ""}`} onBack={() => setView(active ? "session" : "new")}>
      <CenterStageInner active={active} split={split} />
    </ErrorBoundary>
  );
}

function CenterStageInner({ active, split }: { active: Teammate | undefined; split: Teammate | undefined }) {
  const view = useApp((s) => s.view);
  const focusMode = useApp((s) => s.focusMode);
  const panelSizes = useApp((s) => s.panelSizes);
  const setPanelSize = useApp((s) => s.setPanelSize);
  const simple = useApp((s) => uiLayoutOf(s.appSettings) === "simple");
  // A session split against itself renders no second pane, so it must not
  // reserve half the width either — that leaves dead space with no drag
  // handle to reclaim it. One condition drives both.
  const showSplit = !!split && !!active && split.id !== active.id && !focusMode;
  return (
    <>
    {view === "home" ? (
      simple ? <SimpleOverview /> : <HomeDashboard />
    ) : view === "preview" ? (
      <PreviewPage />
    ) : view === "automations" ? (
      <AutomationsPage />
    ) : view === "brain" ? (
      simple ? <SimpleBrain /> : <BrainPage />
    ) : view === "teammates" ? (
      <TeammatesPage />
    ) : view === "space" ? (
      <Suspense fallback={<div className="flex-1 bg-[#07060a]" />}><SpacePage /></Suspense>
    ) : view === "dna" ? (
      <DNAPage />
    ) : view === "ship" ? (
      <ShipPage />
    ) : view === "flow" ? (
      <FlowPage />
    ) : view === "new" || !active ? (
      <NewSession />
    ) : view === "tasks" || view === "inbox" || view === "feed" || view === "team" ? (
      // team surfaces as full center screens (Monocode-style): the nav
      // rail toggles them; Esc/clicking a session tab returns to it
      <div className="flex-1 min-h-0 flex flex-col max-w-[860px] w-full mx-auto border-x border-line bg-panel">
        {view === "tasks" ? <TaskBoard /> : null}
        {view === "inbox" ? <Inbox /> : null}
        {view === "feed" ? <ActivityTimeline /> : null}
        {view === "team" ? <TeamView /> : null}
      </div>
    ) : (
    <>
    <div className="flex-1 min-h-0 flex">
      <div className="min-w-0 flex" style={{ flexBasis: showSplit ? `${panelSizes.split * 100}%` : "100%" }}>
        <SessionPane mate={active} />
      </div>
      {showSplit ? (
        <>
          <DragHandle onDrag={(dx) => {
            const el = document.querySelector("main");
            if (el) setPanelSize("split", Math.min(0.8, Math.max(0.2, panelSizes.split + dx / el.clientWidth)));
          }} onDone={() => setPanelSize("split", panelSizes.split, true)} />
          <div className="min-w-0 flex flex-1">
            <SessionPane mate={split} />
          </div>
        </>
      ) : null}
    </div>
    </>
    )}
    </>
  );
}

/** Every overlay/modal. Mounted once by whichever shell is showing, so ⌘K
 *  reaches all of them in both layouts. */
export function Overlays() {
  return (
    <>
    <QuickSwitcher />
    <SettingsModal />
    <ProjectPicker />
    <InstallConsent />
    <Onboarding />
    <ReviewModal />
    <SessionHandoff />
    <FeatureIndex />
    <DiffBoard />
    <PrDashboard />
    <CrossSessionSearch />
    <SessionScrubber />
    <PresenceMap />
    <KanbanBoard />
    <TokenDashboard />
    <BranchGraph />
    <StandupSummary />
    <MergeConductor />
    <ReleaseNotes />
    <SessionTemplates />
    <Broadcast />
    <WatchSession />
    <SnippetLibrary />
    <DecisionsLog />
    <Cheatsheet />
    <CheckpointRunner />
    <BridgePanel />
    <Kickoff />
    <ShipQueue />
    <MergeSessions />
    <Toasts />
    </>
  );
}
