import { useState } from 'react';
import { Button, Checkbox, Flex, Popover, Text } from '@radix-ui/themes';
import ColumnCleaningDialog from './ColumnCleaningDialog';

const PREPROCESS_STEPS = [
  { key: 'standardize_headers', label: 'Standardize column headers (snake_case)' },
  { key: 'strip_whitespace', label: 'Strip leading/trailing whitespace' },
  { key: 'unicode_normalize', label: 'Normalize Unicode (NFKC)' },
  { key: 'remove_empty_rows', label: 'Remove fully-empty rows' },
  { key: 'deduplicate_columns', label: 'Deduplicate column names' },
];

const ALL_STEP_KEYS = PREPROCESS_STEPS.map((s) => s.key);

export default function CleaningTab({ datasetId, columns, onMessage, onLogRefresh, onSwitchToChat, pendingRegexEdit, onRegexEditConsumed }) {
  const [running, setRunning] = useState(false);
  const [selectedSteps, setSelectedSteps] = useState(ALL_STEP_KEYS);

  const toggleStep = (key) => {
    setSelectedSteps((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handlePreprocess = async () => {
    if (selectedSteps.length === 0 || running) return;
    onSwitchToChat();
    onMessage({ type: 'user', text: 'Pre-process' });
    setRunning(true);

    try {
      const res = await fetch(`/api/clean/${datasetId}/preprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: selectedSteps }),
      });
      const json = await res.json();

      if (!res.ok) {
        onMessage({ type: 'assistant', text: `Error: ${json.error}` });
        return;
      }

      const parts = [];
      const r = json.results || {};
      if (r.standardize_headers?.renamed && Object.keys(r.standardize_headers.renamed).length > 0) {
        parts.push(`Standardized ${Object.keys(r.standardize_headers.renamed).length} column header(s).`);
      }
      if (r.strip_whitespace?.columns_affected) {
        parts.push(`Stripped whitespace from ${r.strip_whitespace.columns_affected} column(s).`);
      }
      if (r.unicode_normalize?.cells_changed) {
        parts.push(`Normalized ${r.unicode_normalize.cells_changed} cell(s).`);
      }
      if (r.remove_empty_rows?.removed) {
        parts.push(`Removed ${r.remove_empty_rows.removed} empty row(s).`);
      }
      if (r.deduplicate_columns?.renamed && Object.keys(r.deduplicate_columns.renamed).length > 0) {
        parts.push(`Deduplicated ${Object.keys(r.deduplicate_columns.renamed).length} column name(s).`);
      }
      const msg = parts.length > 0 ? parts.join(' ') : 'Pre-processing completed. No changes applied.';

      onMessage({ type: 'assistant', text: msg });
      onLogRefresh();
    } catch (err) {
      onMessage({ type: 'assistant', text: `Network error: ${err.message}` });
    } finally {
      setRunning(false);
    }
  };

  const handleDuplicates = async () => {
    onSwitchToChat();
    onMessage({ type: 'user', text: 'Remove Duplicates' });
    setRunning(true);

    try {
      const res = await fetch(`/api/clean/${datasetId}/duplicates`, { method: 'POST' });
      const json = await res.json();

      if (!res.ok) {
        onMessage({ type: 'assistant', text: `Error: ${json.error}` });
        return;
      }

      const { removed, before, after } = json;
      const msg = removed === 0
        ? `No duplicate rows found. Dataset unchanged (${after.toLocaleString()} rows).`
        : `Removed ${removed.toLocaleString()} duplicate row${removed !== 1 ? 's' : ''} (${before.toLocaleString()} → ${after.toLocaleString()} remaining). Duplicates saved to the Garbage tab.`;

      onMessage({ type: 'assistant', text: msg });
      onLogRefresh();
    } catch (err) {
      onMessage({ type: 'assistant', text: `Network error: ${err.message}` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="action-tab-content">
      <Flex gap="2" align="center" wrap="wrap">
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button size="2" variant="soft" disabled={running}>
              Pre-process
            </Button>
          </Popover.Trigger>
          <Popover.Content>
            <Flex direction="column" gap="3">
              {PREPROCESS_STEPS.map(({ key, label }) => (
                <Text as="label" key={key} size="2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox
                    checked={selectedSteps.includes(key)}
                    onCheckedChange={() => toggleStep(key)}
                  />
                  {label}
                </Text>
              ))}
              <Button
                size="2"
                onClick={handlePreprocess}
                disabled={selectedSteps.length === 0 || running}
              >
                {running ? 'Running…' : 'Confirm'}
              </Button>
            </Flex>
          </Popover.Content>
        </Popover.Root>
        <Button size="2" variant="soft" onClick={handleDuplicates} disabled={running}>
          {running ? 'Running…' : 'Remove Duplicates'}
        </Button>
        <ColumnCleaningDialog
          datasetId={datasetId}
          columns={columns || []}
          onMessage={onMessage}
          onSwitchToChat={onSwitchToChat}
          onLogRefresh={onLogRefresh}
          externalEdit={pendingRegexEdit}
          onConsumeExternalEdit={onRegexEditConsumed}
        >
          <Button size="2" variant="soft" disabled={running}>
            Regex
          </Button>
        </ColumnCleaningDialog>
      </Flex>
    </div>
  );
}
