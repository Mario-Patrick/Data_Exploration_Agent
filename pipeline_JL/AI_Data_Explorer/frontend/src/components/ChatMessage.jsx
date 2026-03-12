import { useMemo } from 'react';
import { Box, Button, Flex, Text } from '@radix-ui/themes';
import { buildPlotlyFigure } from '../utils/buildPlotlyFigure';
import GraphCard from './GraphCard';

function RegexResultCard({ result }) {
  const { column, pattern, match_count, no_match_count, match_examples, no_match_examples } = result;
  const total = match_count + no_match_count;
  const matchPct = total > 0 ? ((match_count / total) * 100).toFixed(1) : '0.0';
  const noMatchPct = total > 0 ? ((no_match_count / total) * 100).toFixed(1) : '0.0';

  return (
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
        <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          Regex check
        </Text>
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
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRight: '1px solid var(--gray-a4)',
            background: 'var(--green-a2)',
          }}
        >
          <Text size="4" weight="bold" style={{ color: 'var(--green-11)', display: 'block' }}>
            ✓ {match_count.toLocaleString()}
          </Text>
          <Text size="1" color="gray">matching · {matchPct}%</Text>
        </Box>
        <Box style={{ flex: 1, padding: '10px 16px', background: 'var(--red-a2)' }}>
          <Text size="4" weight="bold" style={{ color: 'var(--red-11)', display: 'block' }}>
            ✗ {no_match_count.toLocaleString()}
          </Text>
          <Text size="1" color="gray">non-matching · {noMatchPct}%</Text>
        </Box>
      </Flex>

      {/* Examples */}
      <Flex>
        <Box style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid var(--gray-a4)' }}>
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
        <Box style={{ flex: 1, padding: '10px 16px' }}>
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
    </Box>
  );
}

export default function ChatMessage({ message, onAction }) {
  const { type, text, graphs, data, regexResult, actions } = message;
  const isUser = type === 'user';

  const graphItems = useMemo(() => {
    if (!graphs || graphs.length === 0) return [];
    return graphs.map((graph) => ({
      graph,
      figure: buildPlotlyFigure(graph, data),
    }));
  }, [graphs, data]);

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

      {regexResult && <RegexResultCard result={regexResult} />}

      {graphItems.length > 0 && (
        <Flex direction="column" gap="3" style={{ width: '100%' }}>
          {graphItems.map(({ graph, figure }, i) => (
            <GraphCard key={i} graph={graph} figure={figure} />
          ))}
        </Flex>
      )}

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
