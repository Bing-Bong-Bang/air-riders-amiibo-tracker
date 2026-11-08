import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { Notice, Spinner } from "./components/ui";
import { openDatabase } from "./db/database";
import { ensureSeeded } from "./db/seed";
import { initFileSave } from "./lib/fileSave";
import { ModeProvider } from "./lib/mode";
import { useRoute } from "./lib/router";
import { AmiiboPage } from "./pages/AmiiboPage";
import { DataPage } from "./pages/DataPage";
import { FormatsPage } from "./pages/FormatsPage";
import { LogRacePage } from "./pages/LogRacePage";
import { OverviewPage } from "./pages/OverviewPage";
import { RacesPage } from "./pages/RacesPage";
import { LeaderboardsPage } from "./pages/LeaderboardsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { RosterPage } from "./pages/RosterPage";
import { RunPage, RunsPage } from "./pages/RunsPage";
import { StatsPage } from "./pages/StatsPage";
import { StagePage } from "./pages/StagePage";
import { MachinePage } from "./pages/MachinePage";
import { SessionPage } from "./pages/SessionPage";
import { ComparePage } from "./pages/ComparePage";
import { SessionsPage } from "./pages/SessionsPage";
import { CityTrialPage } from "./pages/city/CityTrialPage";

type BootState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

function useBoot(): BootState {
  const [state, setState] = useState<BootState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    openDatabase()
      .then(() => ensureSeeded())
      .then(() => { if (!cancelled) setState({ status: "ready" }); void initFileSave(); })
      .catch((e: Error) => { if (!cancelled) setState({ status: "error", message: e.message }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}

function CurrentPage() {
  const route = useRoute();
  switch (route) {
    case "overview": return <OverviewPage />;
    case "log": return <LogRacePage />;
    case "races": return <RacesPage />;
    case "sessions": return <SessionsPage />;
    case "session": return <SessionPage />;
    case "compare": return <ComparePage />;
    case "runs": return <RunsPage />;
    case "leaderboards": return <LeaderboardsPage />;
    case "recommendations": return <RecommendationsPage />;
    case "run": return <RunPage />;
    case "stats": return <StatsPage />;
    case "stage": return <StagePage />;
    case "machine": return <MachinePage />;
    case "amiibo": return <AmiiboPage />;
    case "formats": return <FormatsPage />;
    case "roster": return <RosterPage />;
    case "city": return <CityTrialPage />;
    case "data": return <DataPage />;
  }
}

export function App() {
  const boot = useBoot();

  if (boot.status !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        {boot.status === "loading"
          ? <Spinner label="Opening your data…" />
          : <div className="max-w-md"><Notice tone="bad" title="The tracker couldn't start">{boot.message}</Notice></div>}
      </div>
    );
  }

  return (
    <ModeProvider>
      <Layout>
        <CurrentPage />
      </Layout>
    </ModeProvider>
  );
}
