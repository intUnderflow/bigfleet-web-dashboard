import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import FleetOverview from "./pages/FleetOverview";
import ShardsList from "./pages/ShardsList";
import ShardDetail from "./pages/ShardDetail";
import ClustersList from "./pages/ClustersList";
import ClusterDetail from "./pages/ClusterDetail";
import Topology from "./pages/Topology";
import ShardReports from "./pages/ShardReports";
import Needs from "./pages/Needs";
import Providers from "./pages/Providers";
import FinOps from "./pages/FinOps";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<FleetOverview />} />
        <Route path="/shards" element={<ShardsList />} />
        <Route path="/shards/:pod" element={<ShardDetail />} />
        <Route path="/clusters" element={<ClustersList />} />
        <Route path="/clusters/:id" element={<ClusterDetail />} />
        <Route path="/topology" element={<Topology />} />
        <Route path="/shard-reports" element={<ShardReports />} />
        <Route path="/needs" element={<Needs />} />
        <Route path="/providers" element={<Providers />} />
        <Route path="/finops" element={<FinOps />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
