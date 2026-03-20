import { useState } from 'react';
import { Box, Button, Card, Dialog, Flex, Slider, Spinner, Text, Badge } from '@radix-ui/themes';
import { LayoutDashboard, TrendingUp } from 'lucide-react';
import { buildPlotlyFigure } from '../utils/buildPlotlyFigure';
import GraphCard from './GraphCard';

// ── KPI Chip ─────────────────────────────────────────────────────────────────
function KpiChip({ label, value, color }) {
  return (
    <Box className="dashboard-kpi">
      <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </Text>
      <Text size="5" weight="bold" style={{ color: color || 'var(--accent-11)' }}>
        {value}
      </Text>
    </Box>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({ summary }) {
  return (
    <Card size="3" style={{ background: 'var(--gray-a2)', border: '1px solid var(--gray-a4)' }}>
      <Flex align="center" gap="2" mb="2">
        <LayoutDashboard size={16} style={{ color: 'var(--accent-9)' }} />
        <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Dataset Overview
        </Text>
      </Flex>
      <Text size="2" style={{ color: 'var(--gray-12)', lineHeight: 1.7 }}>
        {summary}
      </Text>
    </Card>
  );
}

// ── Dashboard AI Analysis Card ───────────────────────────────────────────────
function DashboardInsightsCard({ insights }) {
  return (
    <Card size="3" style={{ background: 'var(--gray-a2)', border: '1px solid var(--accent-a4)' }}>
      <Flex align="center" gap="2" mb="2">
        <TrendingUp size={16} style={{ color: 'var(--accent-9)' }} />
        <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Dashboard AI Analysis
        </Text>
      </Flex>
      <Text size="2" style={{ color: 'var(--gray-12)', lineHeight: 1.7 }}>
        {insights}
      </Text>
    </Card>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DashboardView({ datasetId, rowCount = 0, columns = [] }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'done' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [dashData, setDashData] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sampleSize, setSampleSize] = useState(0);

  const numericCount = dashData?.stats
    ? Object.values(dashData.stats).filter((s) => s.type === 'numeric').length
    : null;
  const categoricalCount = dashData?.stats
    ? Object.values(dashData.stats).filter((s) => s.type === 'categorical').length
    : null;

  const openDialog = () => {
    setSampleSize(Math.min(50000, rowCount));
    setDialogOpen(true);
  };

  const handleGenerate = async () => {
    setDialogOpen(false);
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch(`/api/dashboard/${datasetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_size: sampleSize }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Unknown error');
        setStatus('error');
        return;
      }
      setDashData(json);
      setStatus('done');
    } catch (err) {
      setErrorMsg(`Network error: ${err.message}`);
      setStatus('error');
    }
  };

  const sampleLabel = sampleSize === 0 ? 'All rows' : `${sampleSize.toLocaleString()} rows`;
  const isLoading = status === 'loading';

  // ── Sample-size dialog (always mounted, controlled by dialogOpen state) ──────
  const sampleDialog = (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <Dialog.Content maxWidth="400px">
        <Dialog.Title>Sample size for dashboard</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Choose how many rows to analyse. 0 = all rows; otherwise that many rows are sampled randomly.
        </Dialog.Description>
        <Flex direction="column" gap="3">
          <Text size="2" weight="bold">{sampleLabel}</Text>
          <Slider
            min={0}
            max={rowCount}
            step={1}
            value={[sampleSize]}
            onValueChange={([v]) => setSampleSize(v)}
          />
          <Flex gap="2" justify="end" mt="2">
            <Dialog.Close asChild>
              <Button variant="soft" color="gray">Cancel</Button>
            </Dialog.Close>
            <Button onClick={handleGenerate}>Generate</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );

  // ── Generate / Regenerate button (plain button, no Dialog.Trigger wrapper) ───
  const generateBtn = (
    <Button
      size="2"
      variant="soft"
      disabled={isLoading || rowCount === 0}
      onClick={openDialog}
    >
      {isLoading
        ? <><Spinner size="1" /> Generating…</>
        : status === 'done'
        ? 'Regenerate Dashboard'
        : 'Generate Dashboard'}
    </Button>
  );

  // ── Idle — first visit ────────────────────────────────────────────────────────
  if (status === 'idle') {
    return (
      <div className="panel-view">
        {sampleDialog}
        <Flex align="center" gap="3">
          {generateBtn}
          <Text size="1" color="gray">Generate a comprehensive analysis of your dataset</Text>
        </Flex>

        <Flex gap="3" wrap="wrap" mt="2">
          <KpiChip label="Rows" value={rowCount.toLocaleString()} />
          <KpiChip label="Columns" value={columns.length.toLocaleString()} />
        </Flex>

        <Flex direction="column" align="center" justify="center" gap="2" style={{ flex: 1, opacity: 0.35 }}>
          <LayoutDashboard size={48} style={{ color: 'var(--gray-8)' }} />
          <Text size="2" color="gray">Click &ldquo;Generate Dashboard&rdquo; to get AI-powered charts and insights</Text>
        </Flex>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="panel-view">
        {sampleDialog}
        <Flex align="center" gap="3">
          {generateBtn}
        </Flex>
        <Flex align="center" justify="center" gap="3" style={{ flex: 1 }}>
          <Spinner size="3" />
          <Text size="2" color="gray">Building your dashboard…</Text>
        </Flex>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="panel-view">
        {sampleDialog}
        <Flex align="center" gap="3">
          {generateBtn}
        </Flex>
        <Box mt="3">
          <Text size="2" color="red">⚠ {errorMsg}</Text>
        </Box>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  const { summary, graphs, data, stats } = dashData;

  const graphItems = (graphs || []).map((graph) => ({
    graph,
    figure: buildPlotlyFigure(graph, data || []),
  }));

  const totalNulls = stats
    ? Object.values(stats).reduce((acc, s) => acc + (s.null_count || 0), 0)
    : 0;

  return (
    <div className="panel-view">
      {sampleDialog}

      {/* Top action row */}
      <Flex align="center" gap="3" style={{ flexShrink: 0 }}>
        {generateBtn}
        <Badge color="sky" variant="soft" size="1">
          {graphItems.length} chart{graphItems.length !== 1 ? 's' : ''}
        </Badge>
      </Flex>

      {/* Summary narrative */}
      {summary && <SummaryCard summary={summary} />}

      {/* Cross-chart AI analysis */}
      {dashData.dashboard_insights && <DashboardInsightsCard insights={dashData.dashboard_insights} />}

      {/* KPI chips */}
      <Flex gap="3" wrap="wrap">
        <KpiChip label="Rows" value={rowCount.toLocaleString()} />
        <KpiChip label="Columns" value={columns.length.toLocaleString()} />
        {numericCount !== null && (
          <KpiChip label="Numeric cols" value={numericCount} color="var(--green-11)" />
        )}
        {categoricalCount !== null && (
          <KpiChip label="Categorical cols" value={categoricalCount} color="var(--purple-11)" />
        )}
        {totalNulls > 0 && (
          <KpiChip label="Total nulls" value={totalNulls.toLocaleString()} color="var(--amber-11)" />
        )}
      </Flex>

      {/* Column statistics table */}
      {stats && Object.keys(stats).length > 0 && (
        <Card size="2" style={{ border: '1px solid var(--gray-a4)', overflowX: 'auto' }}>
          <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>
            Column Statistics
          </Text>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--gray-a4)', textAlign: 'left' }}>
                {['Column', 'Type', 'Unique', 'Nulls', 'Min', 'Max', 'Mean'].map((h) => (
                  <th key={h} style={{ padding: '4px 10px', fontWeight: 600, color: 'var(--gray-10)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats).map(([col, s], i) => (
                <tr
                  key={col}
                  style={{
                    borderBottom: '1px solid var(--gray-a3)',
                    background: i % 2 === 0 ? 'transparent' : 'var(--gray-a1)',
                  }}
                >
                  <td style={{ padding: '5px 10px', fontWeight: 500, color: 'var(--gray-12)', whiteSpace: 'nowrap' }}>{col}</td>
                  <td style={{ padding: '5px 10px' }}>
                    <Badge color={s.type === 'numeric' ? 'green' : 'purple'} variant="soft" size="1">{s.type}</Badge>
                  </td>
                  <td style={{ padding: '5px 10px', color: 'var(--gray-11)' }}>{s.unique_count?.toLocaleString() ?? '—'}</td>
                  <td style={{ padding: '5px 10px', color: s.null_count > 0 ? 'var(--amber-11)' : 'var(--gray-11)' }}>
                    {s.null_count?.toLocaleString() ?? '—'}
                  </td>
                  <td style={{ padding: '5px 10px', color: 'var(--gray-11)', fontFamily: 'monospace' }}>{s.min ?? '—'}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--gray-11)', fontFamily: 'monospace' }}>{s.max ?? '—'}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--gray-11)', fontFamily: 'monospace' }}>
                    {s.mean != null ? Number(s.mean).toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Charts grid */}
      {graphItems.length > 0 && (
        <>
          <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
            Charts
          </Text>
          <div className="dashboard-charts-grid">
            {graphItems.map(({ graph, figure }, i) => (
              <GraphCard key={i} graph={graph} figure={figure} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
