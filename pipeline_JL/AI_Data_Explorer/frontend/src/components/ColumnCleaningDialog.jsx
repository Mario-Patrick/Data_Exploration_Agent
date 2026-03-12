import { useState, useEffect } from 'react';
import { Button, Dialog, Flex, IconButton, Popover, ScrollArea, Spinner, Text, TextArea, TextField } from '@radix-ui/themes';
import { ChevronDown, Sparkles, X } from 'lucide-react';

// Normalise stored pattern entry — handles both old string format and new object format
function parseSaved(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { pattern: entry, match_count: null, no_match_count: null };
  return entry;
}

export default function ColumnCleaningDialog({
  datasetId,
  columns,
  onMessage,
  onSwitchToChat,
  onLogRefresh,
  externalEdit,
  onConsumeExternalEdit,
  children,
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [regexOpen, setRegexOpen] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState('');
  const [pattern, setPattern] = useState('');
  const [hint, setHint] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [savedPatterns, setSavedPatterns] = useState({});
  const [samplesCache, setSamplesCache] = useState({});   // { [col]: string[] }
  const [loadingSamples, setLoadingSamples] = useState(null); // col name being fetched
  const [aiReason, setAiReason] = useState('');
  const [reasonPopoverOpen, setReasonPopoverOpen] = useState(false);

  useEffect(() => {
    if (externalEdit) {
      setSelectedColumn(externalEdit.column);
      setPattern(externalEdit.pattern || '');
      setHint('');
      setError('');
      setRegexOpen(true);
      onConsumeExternalEdit();
    }
  }, [externalEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSavedPatterns = async () => {
    try {
      const res = await fetch(`/api/clean/${datasetId}/regex-patterns`);
      if (res.ok) setSavedPatterns(await res.json());
    } catch { /* non-critical */ }
  };

  const handleColumnsOpen = (open) => {
    setColumnsOpen(open);
    if (open) fetchSavedPatterns();
  };

  const fetchColumnSamples = async (col) => {
    if (samplesCache[col]) return;
    setLoadingSamples(col);
    try {
      const res = await fetch(`/api/clean/${datasetId}/column-samples?column=${encodeURIComponent(col)}`);
      if (res.ok) {
        const data = await res.json();
        setSamplesCache((prev) => ({ ...prev, [col]: data.samples }));
      }
    } catch { /* non-critical */ }
    finally { setLoadingSamples(null); }
  };

  const handleColumnClick = (col) => {
    const saved = parseSaved(savedPatterns[col]);
    setSelectedColumn(col);
    setPattern(saved?.pattern || '');
    setHint('');
    setError('');
    setColumnsOpen(false);
    setRegexOpen(true);
  };

  const handleRegexOpenChange = (open) => {
    setRegexOpen(open);
    if (!open) setError('');
  };

  const handleAiSuggest = async () => {
    setAiLoading(true);
    setError('');
    setAiReason('');
    try {
      const res = await fetch(`/api/clean/${datasetId}/regex-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: selectedColumn, hint, previous_pattern: pattern }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'AI suggestion failed.');
      else {
        setPattern(json.pattern);
        setAiReason(json.reason || '');
        setReasonPopoverOpen(true);
      }
    } catch (err) {
      setError(`Network error: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!pattern.trim()) return;
    setRunning(true);
    setError('');
    try {
      const res = await fetch(`/api/clean/${datasetId}/regex-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: selectedColumn, pattern: pattern.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Check failed.'); return; }

      setRegexOpen(false);
      onMessage({ type: 'user', text: `Column Cleaning → regex check on "${selectedColumn}"` });
      onMessage({
        type: 'assistant',
        regexResult: {
          column: json.column,
          pattern: json.pattern,
          match_count: json.match_count,
          no_match_count: json.no_match_count,
          match_examples: json.match_examples,
          no_match_examples: json.no_match_examples,
        },
        actions: [
          { label: 'Edit Regex', type: 'edit_regex', column: json.column, pattern: json.pattern },
        ],
      });
      onSwitchToChat();
      if (onLogRefresh) onLogRefresh();
    } catch (err) {
      setError(`Network error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      {/* Dialog 1: Column selection */}
      <Dialog.Root open={columnsOpen} onOpenChange={handleColumnsOpen}>
        <Dialog.Trigger asChild>{children}</Dialog.Trigger>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>Select a column</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            Choose a column to test a regex pattern against.
          </Dialog.Description>

          <ScrollArea mt="3" style={{ maxHeight: 380 }}>
            <Flex gap="2" wrap="wrap" pr="2">
              {columns.map((col) => {
                const saved = parseSaved(savedPatterns[col]);
                const hasStats = saved && saved.match_count !== null;
                return (
                  <div
                    key={col}
                    style={{
                      border: `1px solid ${saved ? 'var(--accent-6)' : 'var(--gray-a5)'}`,
                      borderRadius: 'var(--radius-2)',
                      overflow: 'hidden',
                      minWidth: 130,
                      background: saved ? 'var(--accent-a2)' : 'var(--color-panel)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {/* Main clickable row */}
                    <Flex align="center" style={{ minHeight: 34 }}>
                      <button
                        onClick={() => handleColumnClick(col)}
                        style={{
                          flex: 1,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '6px 10px',
                          textAlign: 'left',
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--gray-12)',
                          lineHeight: 1.3,
                          wordBreak: 'break-word',
                        }}
                      >
                        {col}
                      </button>

                      {/* Sample data dropdown */}
                      <Popover.Root onOpenChange={(open) => open && fetchColumnSamples(col)}>
                        <Popover.Trigger asChild>
                          <IconButton
                            size="1"
                            variant="ghost"
                            color="gray"
                            title="Preview sample values"
                            style={{ marginRight: 4, flexShrink: 0 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ChevronDown size={11} />
                          </IconButton>
                        </Popover.Trigger>
                        <Popover.Content style={{ width: 220, padding: 0 }} side="bottom" align="end">
                          <Text
                            size="1"
                            weight="bold"
                            color="gray"
                            style={{
                              display: 'block',
                              padding: '6px 10px 4px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              borderBottom: '1px solid var(--gray-a4)',
                            }}
                          >
                            Samples · {col}
                          </Text>
                          <ScrollArea style={{ maxHeight: 200 }}>
                            <div style={{ padding: '6px 10px 8px' }}>
                              {loadingSamples === col ? (
                                <Flex align="center" gap="2" py="2">
                                  <Spinner size="1" /><Text size="1" color="gray">Loading…</Text>
                                </Flex>
                              ) : samplesCache[col]?.length ? (
                                samplesCache[col].map((v, i) => (
                                  <Text
                                    key={i}
                                    size="1"
                                    style={{
                                      display: 'block',
                                      fontFamily: 'monospace',
                                      padding: '2px 0',
                                      color: 'var(--gray-11)',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {v}
                                  </Text>
                                ))
                              ) : (
                                <Text size="1" color="gray">No samples available.</Text>
                              )}
                            </div>
                          </ScrollArea>
                        </Popover.Content>
                      </Popover.Root>
                    </Flex>

                    {/* Compact stats bar */}
                    {saved && (
                      <div
                        style={{
                          borderTop: '1px solid var(--gray-a3)',
                          padding: '3px 10px 4px',
                          background: 'var(--gray-a1)',
                        }}
                      >
                        <Text
                          size="1"
                          style={{
                            fontFamily: 'monospace',
                            color: 'var(--gray-9)',
                            fontSize: 10,
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={`/${saved.pattern}/`}
                        >
                          /{saved.pattern}/
                        </Text>
                        {hasStats && (
                          <Flex gap="2" mt="1">
                            <Text size="1" style={{ color: 'var(--green-10)', fontSize: 10 }}>
                              ✓ {saved.match_count.toLocaleString()}
                            </Text>
                            <Text size="1" style={{ color: 'var(--red-10)', fontSize: 10 }}>
                              ✗ {saved.no_match_count.toLocaleString()}
                            </Text>
                          </Flex>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Flex>
          </ScrollArea>

          <Flex justify="end" mt="4">
            <Dialog.Close asChild>
              <Button variant="soft" color="gray">Close</Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Dialog 2: Regex input (independent) */}
      <Dialog.Root open={regexOpen} onOpenChange={handleRegexOpenChange}>
        <Dialog.Content maxWidth="440px">
          <Dialog.Title>
            Regex pattern for &ldquo;{selectedColumn}&rdquo;
          </Dialog.Title>

          <Flex align="center" justify="between" mt="1">
            <Dialog.Description size="2" color="gray" mb="0">
              Enter a pattern (fullmatch). Use the AI button to generate one.
            </Dialog.Description>
            <Popover.Root onOpenChange={(open) => open && fetchColumnSamples(selectedColumn)}>
              <Popover.Trigger asChild>
                <button
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--gray-9)', fontSize: 11, flexShrink: 0, padding: '2px 4px',
                    borderRadius: 'var(--radius-1)',
                  }}
                >
                  samples <ChevronDown size={10} />
                </button>
              </Popover.Trigger>
              <Popover.Content style={{ width: 220, padding: 0 }} side="bottom" align="end">
                <Text
                  size="1"
                  weight="bold"
                  color="gray"
                  style={{
                    display: 'block', padding: '6px 10px 4px',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid var(--gray-a4)',
                  }}
                >
                  Samples · {selectedColumn}
                </Text>
                <ScrollArea style={{ maxHeight: 200 }}>
                  <div style={{ padding: '6px 10px 8px' }}>
                    {loadingSamples === selectedColumn ? (
                      <Flex align="center" gap="2" py="2">
                        <Spinner size="1" /><Text size="1" color="gray">Loading…</Text>
                      </Flex>
                    ) : samplesCache[selectedColumn]?.length ? (
                      samplesCache[selectedColumn].map((v, i) => (
                        <Text
                          key={i}
                          size="1"
                          style={{
                            display: 'block', fontFamily: 'monospace',
                            padding: '2px 0', color: 'var(--gray-11)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {v}
                        </Text>
                      ))
                    ) : (
                      <Text size="1" color="gray">No samples available.</Text>
                    )}
                  </div>
                </ScrollArea>
              </Popover.Content>
            </Popover.Root>
          </Flex>

          <Flex gap="2" mt="3" align="center">
            <TextField.Root
              style={{ flex: 1, fontFamily: 'monospace' }}
              placeholder={String.raw`e.g. \d{4}-\d{2}-\d{2}`}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleConfirm()}
            />
            <Popover.Root open={reasonPopoverOpen} onOpenChange={(open) => { setReasonPopoverOpen(open); if (open) handleAiSuggest(); }}>
              <Popover.Trigger asChild>
                <IconButton
                  size="2"
                  variant="soft"
                  title="Ask AI to suggest a regex"
                  disabled={aiLoading || running}
                >
                  {aiLoading ? <Spinner size="1" /> : <Sparkles size={14} />}
                </IconButton>
              </Popover.Trigger>
              <Popover.Content side="right" align="start" width="280px" style={{ padding: 0 }}>
                <Flex direction="column">
                  <Flex align="center" justify="end" style={{ padding: '6px 6px 0' }}>
                    <Popover.Close asChild>
                      <IconButton size="1" variant="ghost" color="gray" title="Close">
                        <X size={14} />
                      </IconButton>
                    </Popover.Close>
                  </Flex>
                  <div style={{ padding: '0 12px 12px' }}>
                    {aiLoading ? (
                      <Flex align="center" gap="2" py="2">
                        <Spinner size="1" />
                        <Text size="1" color="gray">Getting suggestion…</Text>
                      </Flex>
                    ) : aiReason ? (
                      <Text size="1" as="p" style={{ whiteSpace: 'pre-wrap' }}>{aiReason}</Text>
                    ) : (
                      <Text size="1" color="gray">No explanation provided.</Text>
                    )}
                  </div>
                </Flex>
              </Popover.Content>
            </Popover.Root>
          </Flex>

          <TextArea
            mt="2"
            size="1"
            placeholder="Extra instructions for AI — e.g. 'must allow hyphens' or 'previous pattern was too strict'"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            rows={2}
            style={{ resize: 'none', fontSize: '12px' }}
          />

          {error && <Text size="1" color="red" mt="2" as="p">{error}</Text>}

          <Flex gap="2" mt="4" justify="end">
            <Dialog.Close asChild>
              <Button variant="soft" color="gray" disabled={running}>Cancel</Button>
            </Dialog.Close>
            <Button onClick={handleConfirm} disabled={!pattern.trim() || running || aiLoading}>
              {running ? <><Spinner size="1" />&nbsp;Running…</> : 'Confirm'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
