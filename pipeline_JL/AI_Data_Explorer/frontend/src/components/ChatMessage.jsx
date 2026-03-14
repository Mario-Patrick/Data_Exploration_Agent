import { useMemo, useState, useEffect, useCallback } from 'react';
import { Box, Button, Dialog, Flex, Popover, ScrollArea, Spinner, Text, Tooltip } from '@radix-ui/themes';
import { Sparkles, Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { buildPlotlyFigure } from '../utils/buildPlotlyFigure';
import GraphCard from './GraphCard';

const PAGE_SIZE = 20;

function RegexDetailDialog({ datasetId, column, pattern, type, onClose }) {
  // These values survive re-renders of the component. They also trigger re-renders when used conditionally in the render. 
  // Like when loading true, the component will re-render with the loading state.
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');


  // If the [datasetId, column, type] changes, fetchPage becomes a new function (reference changes). This means useEffect which has this dependency will run again setting it to page 0.
  const fetchPage = useCallback(async (p) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/clean/${datasetId}/regex-results/${encodeURIComponent(column)}?type=${type}&page=${p}&page_size=${PAGE_SIZE}`
      );
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Failed to load'); return; }
      setData(json);
      setPage(p);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [datasetId, column, type]);

  // useEffect will run when the component mounts and when the fetchPage function changes (reference changes). (setting page to 0)
  useEffect(() => { fetchPage(0); }, [fetchPage]);

  const color = type === 'match' ? 'var(--green-11)' : 'var(--red-11)';
  const label = type === 'match' ? 'Matching' : 'Non-matching';

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content maxWidth="500px">
        <Dialog.Title>
          {label} values — <Text style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>/{pattern}/</Text>
        </Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Column: <strong>{column}</strong>
          {data && <> · {data.total.toLocaleString()} total</>}
        </Dialog.Description>

        <Box style={{ minHeight: 200, position: 'relative' }}>
          {loading && !data && <Flex justify="center" py="6"><Spinner /></Flex>}
          {error && <Text color="red" size="2">{error}</Text>}
          {data && data.values.length === 0 && (
            <Text size="2" color="gray">(none)</Text>
          )}
          {data && (
            <Box style={{ opacity: loading ? 0.4 : 1, transition: 'opacity 0.1s' }}>
              {data.values.map((v, i) => (
                <Text
                  key={i}
                  size="1"
                  style={{
                    fontFamily: 'monospace',
                    display: 'block',
                    color,
                    padding: '3px 0',
                    borderBottom: '1px solid var(--gray-a3)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {v}
                </Text>
              ))}
            </Box>
          )}
        </Box>

        {data && data.total > PAGE_SIZE && (
          <Flex align="center" justify="between" mt="3">
            <Button
              size="1"
              variant="soft"
              disabled={page === 0 || loading}
              onClick={() => fetchPage(page - 1)}
            >
              ← Prev
            </Button>
            <Text size="1" color="gray">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
            </Text>
            <Button
              size="1"
              variant="soft"
              disabled={!data.has_more || loading}
              onClick={() => fetchPage(page + 1)}
            >
              Next →
            </Button>
          </Flex>
        )}

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button size="2" variant="soft" color="gray">Close</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function highlightMatches(text, pattern, isRegex) {
  if (!pattern) return [{ text, highlight: false }];
  try {
    const escaped = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const parts = [];
    let last = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index), highlight: false });
      parts.push({ text: m[0], highlight: true });
      last = m.index + m[0].length;
      if (m[0].length === 0) { last++; break; } // guard against zero-width matches
    }
    if (last <= text.length) parts.push({ text: text.slice(last), highlight: false });
    return parts;
  } catch {
    return [{ text, highlight: false }];
  }
}

function RegexResultCard({ result, onResultUpdate }) {
  const [liveResult, setLiveResult] = useState(result);
  const { datasetId, column, pattern, match_count, no_match_count, match_examples, no_match_examples } = liveResult;
  const [dialog, setDialog] = useState(null); // 'match' | 'no_match' | null
  const [recState, setRecState] = useState({ status: 'idle', recommendations: [], error: null });
  const [applyState, setApplyState] = useState({}); // script_id -> 'idle'|'applying'|'applied'|'error'
  const [applyResults, setApplyResults] = useState({}); // script_id -> { changed_count }
  const [garbageState, setGarbageState] = useState('idle'); // 'idle'|'sending'|'done'|'error'
  const [garbageResult, setGarbageResult] = useState(null); // { nullified_count }
  const [regexLoading, setRegexLoading] = useState(false);
  const [frOpen, setFrOpen] = useState(false);
  const [frPattern, setFrPattern] = useState('');
  const [frIsRegex, setFrIsRegex] = useState(false);
  const [frReplacement, setFrReplacement] = useState('');
  const [frPreview, setFrPreview] = useState([]);
  const [frPreviewLoading, setFrPreviewLoading] = useState(false);
  const [frPreviewError, setFrPreviewError] = useState(null);
  const [frScope, setFrScope] = useState('both');
  const [frApplyState, setFrApplyState] = useState('idle');
  const [frApplyResult, setFrApplyResult] = useState(null);

  const reRunRegex = async () => {
    setRegexLoading(true);
    try {
      const res = await fetch(`/api/clean/${datasetId}/regex-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column, pattern }),
      });
      const json = await res.json();
      if (res.ok) {
        setLiveResult((prev) => {
          const updated = {
            ...prev,
            match_count: json.match_count,
            no_match_count: json.no_match_count,
            match_examples: json.match_examples,
            no_match_examples: json.no_match_examples,
          };
          onResultUpdate?.(updated);
          return updated;
        });
      }
    } catch {
      // silently ignore — old results remain visible
    } finally {
      setRegexLoading(false);
    }
  };

  const fetchRecommendations = () => {
    setRecState({ status: 'loading', recommendations: [], error: null });
    fetch(`/api/clean/${datasetId}/recommend-cleaning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column }),
    })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        setRecState(ok
          ? { status: 'done', recommendations: json.recommendations || [], error: null }
          : { status: 'error', recommendations: [], error: json.error || 'Failed' });
      })
      .catch(() => setRecState({ status: 'error', recommendations: [], error: 'Network error' }));
  };

  useEffect(() => {
    if (!frOpen || !frPattern) { setFrPreview([]); setFrPreviewError(null); return; }
    setFrPreviewLoading(true);
    setFrPreviewError(null);
    const timer = setTimeout(() => {
      fetch(`/api/clean/${datasetId}/find-replace-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column, pattern: frPattern, is_regex: frIsRegex, scope: frScope }),
      })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (ok) { setFrPreview(j.matches || []); setFrPreviewError(null); }
          else { setFrPreview([]); setFrPreviewError(j.error || 'Error'); }
        })
        .catch(() => setFrPreviewError('Network error'))
        .finally(() => setFrPreviewLoading(false));
    }, 300);
    return () => { clearTimeout(timer); setFrPreviewLoading(false); };
  }, [frPattern, frIsRegex, frScope, frOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFrApply = async () => {
    setFrApplyState('applying');
    try {
      const res = await fetch(`/api/clean/${datasetId}/find-replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column, pattern: frPattern, replacement: frReplacement, is_regex: frIsRegex, scope: frScope }),
      });
      const json = await res.json();
      if (!res.ok) { setFrApplyState('error'); }
      else {
        setFrApplyState('done');
        setFrApplyResult({ changed_count: json.changed_count });
        setFrPattern('');
        setFrReplacement('');
        setFrIsRegex(false);
        setFrScope('both');
        reRunRegex();
      }
    } catch { setFrApplyState('error'); }
  };

  const handleGarbage = async () => {
    setGarbageState('sending');
    try {
      const res = await fetch(`/api/clean/${datasetId}/send-to-garbage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column }),
      });
      const json = await res.json();
      if (!res.ok) {
        setGarbageState('error');
      } else {
        setGarbageState('done');
        setGarbageResult({ nullified_count: json.nullified_count });
      }
    } catch {
      setGarbageState('error');
    }
  };

  const handleApply = async (script_id) => {
    setApplyState((prev) => ({ ...prev, [script_id]: 'applying' }));
    try {
      const res = await fetch(`/api/clean/${datasetId}/apply-cleaning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column, script_id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setApplyState((prev) => ({ ...prev, [script_id]: 'error' }));
      } else {
        setApplyState((prev) => ({ ...prev, [script_id]: 'applied' }));
        setApplyResults((prev) => ({ ...prev, [script_id]: { changed_count: json.changed_count } }));
        reRunRegex();
      }
    } catch {
      setApplyState((prev) => ({ ...prev, [script_id]: 'error' }));
    }
  };
  const total = match_count + no_match_count;
  const matchPct = total > 0 ? ((match_count / total) * 100).toFixed(1) : '0.0';
  const noMatchPct = total > 0 ? ((no_match_count / total) * 100).toFixed(1) : '0.0';
  const canDrill = !!datasetId;

  return (
    <>
      {dialog && (
        <RegexDetailDialog
          datasetId={datasetId}
          column={column}
          pattern={pattern}
          type={dialog}
          onClose={() => setDialog(null)}
        />
      )}
      <Box
        style={{
          borderRadius: '0.75rem',
          border: '1px solid var(--gray-a5)',
          overflow: 'hidden',
          background: 'var(--color-panel)',
          boxShadow: 'var(--shadow-1)',
          maxWidth: '560px',
          fontSize: '13px',
        }}
      >
        {/* Header */}
        <Box
          px="3"
          py="2"
          style={{ borderBottom: '1px solid var(--gray-a4)', background: 'var(--gray-a2)' }}
        >
          <Flex align="center" justify="between">
            <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Regex check
            </Text>
            {datasetId && (
              <button
                onClick={reRunRegex}
                disabled={regexLoading}
                title="Re-run regex check"
                style={{ background: 'none', border: 'none', cursor: regexLoading ? 'default' : 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: 'var(--gray-9)' }}
              >
                <RefreshCw size={12} style={regexLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
              </button>
            )}
          </Flex>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          <Flex align="baseline" gap="2" mt="1">
            <Text size="2" weight="bold">{column}</Text>
            <Text
              size="1"
              style={{
                fontFamily: 'monospace',
                background: 'var(--gray-a3)',
                padding: '1px 6px',
                borderRadius: '4px',
                color: 'var(--gray-11)',
              }}
            >
              /{pattern}/
            </Text>
          </Flex>
        </Box>

        {/* Stats row */}
        <Flex style={{ borderBottom: '1px solid var(--gray-a4)' }}>
          <Box
            onClick={canDrill ? () => setDialog('match') : undefined}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRight: '1px solid var(--gray-a4)',
              background: 'var(--green-a2)',
              cursor: canDrill ? 'pointer' : 'default',
            }}
          >
            <Text size="4" weight="bold" style={{ color: 'var(--green-11)', display: 'block' }}>
              ✓ {match_count.toLocaleString()}
            </Text>
            <Text size="1" color="gray">matching · {matchPct}%{canDrill && ' · click to browse'}</Text>
          </Box>
          <Box
            onClick={canDrill ? () => setDialog('no_match') : undefined}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'var(--red-a2)',
              cursor: canDrill ? 'pointer' : 'default',
            }}
          >
            <Text size="4" weight="bold" style={{ color: 'var(--red-11)', display: 'block' }}>
              ✗ {no_match_count.toLocaleString()}
            </Text>
            <Text size="1" color="gray">non-matching · {noMatchPct}%{canDrill && ' · click to browse'}</Text>
          </Box>
        </Flex>

        {/* Examples */}
        <Flex>
          <Box style={{ flex: 1, maxWidth: '50%', padding: '10px 16px', borderRight: '1px solid var(--gray-a4)' }}>
            <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
              Matching
            </Text>
            {match_examples.length > 0
              ? match_examples.map((v, i) => (
                  <Text key={i} size="1" style={{ fontFamily: 'monospace', display: 'block', color: 'var(--green-11)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v}
                  </Text>
                ))
              : <Text size="1" color="gray">(none)</Text>}
          </Box>
          <Box style={{ flex: 1, maxWidth: '50%', padding: '10px 16px' }}>
            <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
              Non-matching
            </Text>
            {no_match_examples.length > 0
              ? no_match_examples.map((v, i) => (
                  <Text key={i} size="1" style={{ fontFamily: 'monospace', display: 'block', color: 'var(--red-11)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v}
                  </Text>
                ))
              : <Text size="1" color="gray">(none)</Text>}
          </Box>
        </Flex>

        {/* Find & Replace */}
        {datasetId && (
          <Box style={{ borderTop: '1px solid var(--gray-a4)' }}>
            <button
              onClick={() => setFrOpen((o) => !o)}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gray-11)' }}
            >
              <ChevronDown size={12} style={{ transform: frOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
              <Text size="1" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Find &amp; Replace</Text>
            </button>
            {frOpen && (
              <Box px="3" pb="3" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* From row — preview popover to the right, portaled out of card DOM */}
                <Popover.Root open={!!frPattern} onOpenChange={() => {}}>
                  <Popover.Trigger asChild>
                    {/* Plain div so asChild ref-forwarding works reliably */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        placeholder={frIsRegex ? 'Regex pattern…' : 'Find text…'}
                        value={frPattern}
                        onChange={(e) => { setFrPattern(e.target.value); setFrApplyState('idle'); }}
                        style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--gray-a6)', background: 'var(--color-surface)', color: 'var(--gray-12)', outline: 'none' }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--gray-10)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={frIsRegex} onChange={(e) => { setFrIsRegex(e.target.checked); setFrApplyState('idle'); }} />
                        regex
                      </label>
                    </div>
                  </Popover.Trigger>
                  <Popover.Content
                    side="right"
                    align="start"
                    sideOffset={8}
                    style={{ width: 260, padding: 0 }}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onInteractOutside={(e) => e.preventDefault()}
                    onFocusOutside={(e) => e.preventDefault()}
                  >
                    <Text size="1" weight="bold" color="gray" style={{ display: 'block', padding: '6px 10px 4px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--gray-a4)' }}>
                      Preview matches
                    </Text>
                    <ScrollArea style={{ maxHeight: 220 }}>
                      <div style={{ padding: '6px 10px 8px' }}>
                        {frPreviewLoading && (
                          <Flex align="center" gap="2" py="2">
                            <Spinner size="1" /><Text size="1" color="gray">Searching…</Text>
                          </Flex>
                        )}
                        {!frPreviewLoading && frPreviewError && <Text size="1" color="red">{frPreviewError}</Text>}
                        {!frPreviewLoading && !frPreviewError && frPreview.length === 0 && <Text size="1" color="gray">No matches found</Text>}
                        {!frPreviewLoading && frPreview.map((val, i) => (
                          <div key={i} style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: '1.8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {highlightMatches(val, frPattern, frIsRegex).map((part, j) => (
                              <span key={j} style={part.highlight ? { background: 'var(--amber-5)', borderRadius: 2, padding: '0 1px' } : undefined}>
                                {part.text}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </Popover.Content>
                </Popover.Root>

                {/* Scope toggle */}
                <Flex gap="1">
                  {[['both', 'Both'], ['matching', 'Matching'], ['non_matching', 'Non-matching']].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => { setFrScope(val); setFrApplyState('idle'); }}
                      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--gray-a6)', background: frScope === val ? 'var(--accent-9)' : 'var(--color-surface)', color: frScope === val ? 'white' : 'var(--gray-11)', cursor: 'pointer' }}
                    >
                      {label}
                    </button>
                  ))}
                </Flex>

                {/* To row */}
                <input
                  placeholder="Replace with…"
                  value={frReplacement}
                  onChange={(e) => { setFrReplacement(e.target.value); setFrApplyState('idle'); }}
                  style={{ fontFamily: 'monospace', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--gray-a6)', background: 'var(--color-surface)', color: 'var(--gray-12)', outline: 'none' }}
                />

                {/* Apply */}
                <div>
                  <Button
                    size="1"
                    disabled={!frPattern || frApplyState === 'applying'}
                    color={frApplyState === 'done' ? 'green' : frApplyState === 'error' ? 'red' : 'blue'}
                    onClick={handleFrApply}
                    style={{ gap: 4 }}
                  >
                    {frApplyState === 'applying' && <><Spinner size="1" /> Applying…</>}
                    {frApplyState === 'done' && <>✓ Applied · {frApplyResult?.changed_count} changed</>}
                    {frApplyState === 'error' && <>✗ Failed</>}
                    {frApplyState === 'idle' && <>Apply</>}
                  </Button>
                </div>
              </Box>
            )}
          </Box>
        )}

        {/* AI Fix Suggestions */}
        {no_match_count > 0 && datasetId && (
          <Box px="3" py="2" style={{ borderTop: '1px solid var(--gray-a4)', background: 'var(--gray-a1)' }}>
            {recState.status === 'idle' && (
              <Button size="1" variant="ghost" color="violet" onClick={fetchRecommendations} style={{ gap: 4 }}>
                <Sparkles size={11} /> Get AI fix suggestions
              </Button>
            )}
            {recState.status !== 'idle' && (
              <Flex align="center" justify="between" mb="2">
                <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                  AI Fix Suggestions
                </Text>
                <button
                  onClick={fetchRecommendations}
                  disabled={recState.status === 'loading'}
                  title="Refresh suggestions"
                  style={{ background: 'none', border: 'none', cursor: recState.status === 'loading' ? 'default' : 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: 'var(--gray-9)' }}
                >
                  <RefreshCw size={11} style={recState.status === 'loading' ? { animation: 'spin 1s linear infinite' } : undefined} />
                </button>
              </Flex>
            )}
            {recState.status === 'loading' && (
              <Flex align="center" gap="2">
                <Spinner size="1" />
                <Text size="1" color="gray">Analyzing non-matching values…</Text>
              </Flex>
            )}
            {recState.status === 'error' && (
              <Button size="1" variant="ghost" color="red" onClick={fetchRecommendations} style={{ gap: 4 }}>
                ✗ Failed — retry
              </Button>
            )}
            {recState.status === 'done' && recState.recommendations.length === 0 && (
              <Text size="1" color="gray">No automated fixes found for these values.</Text>
            )}
            {recState.status === 'done' && recState.recommendations.length > 0 && (
              <Flex gap="2" wrap="wrap">
                {recState.recommendations.map(({ script_id, reason, description }) => {
                  const state = applyState[script_id] || 'idle';
                  const result = applyResults[script_id];
                  return (
                    <Tooltip
                      key={script_id}
                      content={
                        <div style={{ maxWidth: 220 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{description}</div>
                          <div style={{ opacity: 0.85 }}>{reason}</div>
                        </div>
                      }
                      side="top"
                      delayDuration={200}
                    >
                      <Button
                        size="1"
                        variant="soft"
                        color={state === 'applied' ? 'green' : state === 'error' ? 'red' : 'violet'}
                        disabled={state === 'applying' || state === 'applied'}
                        onClick={() => handleApply(script_id)}
                        style={{ borderRadius: '999px', gap: 4 }}
                      >
                        {state === 'applying' && <><Spinner size="1" /> Applying…</>}
                        {state === 'applied' && <>✓ Applied{result ? ` · ${result.changed_count} changed` : ''}</>}
                        {state === 'error' && <>✗ Failed</>}
                        {state === 'idle' && <><Sparkles size={11} /> {script_id.replace(/_/g, ' ')}</>}
                      </Button>
                    </Tooltip>
                  );
                })}
              </Flex>
            )}
          </Box>
        )}
        {/* Send to Garbage */}
        {no_match_count > 0 && datasetId && (
          <Box px="3" py="2" style={{ borderTop: '1px solid var(--gray-a4)' }}>
            <Button
              size="1"
              variant="soft"
              color={garbageState === 'done' ? 'green' : garbageState === 'error' ? 'red' : 'gray'}
              disabled={garbageState === 'sending' || garbageState === 'done'}
              onClick={handleGarbage}
              title="Nullify all non-matching cells and save them to a garbage file"
              style={{ gap: 4 }}
            >
              {garbageState === 'sending' && <><Spinner size="1" /> Sending…</>}
              {garbageState === 'done' && <>✓ Sent to garbage{garbageResult ? ` · ${garbageResult.nullified_count} nullified` : ''}</>}
              {garbageState === 'error' && <>✗ Failed</>}
              {garbageState === 'idle' && <><Trash2 size={11} /> Send non-matching to garbage</>}
            </Button>
          </Box>
        )}
      </Box>
    </>
  );
}

function MessageGraphs({ graphs, data }) {
  const graphItems = useMemo(() => {
    if (!graphs || graphs.length === 0) return [];
    return graphs.map((graph) => ({
      graph,
      figure: buildPlotlyFigure(graph, data),
    }));
  }, [graphs, data]);

  if (graphItems.length === 0) return null;

  return (
    <Flex direction="column" gap="3" style={{ width: '100%' }}>
      {graphItems.map(({ graph, figure }, i) => (
        <GraphCard key={i} graph={graph} figure={figure} />
      ))}
    </Flex>
  );
}

export default function ChatMessage({ message, onAction, onRegexResultUpdate }) {
  const { type, text, graphs, data, regexResult, actions } = message;
  const isUser = type === 'user';

  return (
    <Flex
      direction="column"
      align={isUser ? 'end' : 'start'}
      gap="2"
      style={{ width: '100%' }}
    >
      {text && (
        <Box
          px="4"
          py="2"
          style={{
            maxWidth: '78%',
            borderRadius: isUser
              ? '1.25rem 1.25rem 0.3rem 1.25rem'
              : '1.25rem 1.25rem 1.25rem 0.3rem',
            background: isUser ? 'var(--accent-9)' : 'var(--gray-a3)',
            boxShadow: 'var(--shadow-1)',
          }}
        >
          <Text
            size="2"
            style={{ color: isUser ? 'var(--accent-contrast)' : 'var(--gray-12)' }}
          >
            {text}
          </Text>
        </Box>
      )}

      {regexResult && <RegexResultCard result={regexResult} onResultUpdate={onRegexResultUpdate} />}

      <MessageGraphs graphs={graphs} data={data} />

      {actions && actions.length > 0 && onAction && (
        <Flex gap="2" wrap="wrap">
          {actions.map((action, i) => (
            <Button
              key={i}
              size="1"
              variant="soft"
              onClick={() => onAction(action)}
              style={{ borderRadius: '999px' }}
            >
              {action.label}
            </Button>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
