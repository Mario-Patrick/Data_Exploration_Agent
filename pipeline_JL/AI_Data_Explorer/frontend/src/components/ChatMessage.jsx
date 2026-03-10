import { useMemo } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { buildPlotlyFigure } from '../utils/buildPlotlyFigure';
import GraphCard from './GraphCard';

export default function ChatMessage({ message }) {
  const { type, text, graphs, data } = message;
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
          {/* --accent-contrast is Radix's token for readable text on --accent-9 */}
          <Text
            size="2"
            style={{ color: isUser ? 'var(--accent-contrast)' : 'var(--gray-12)' }}
          >
            {text}
          </Text>
        </Box>
      )}

      {graphItems.length > 0 && (
        <Flex direction="column" gap="3" style={{ width: '100%' }}>
          {graphItems.map(({ graph, figure }, i) => (
            <GraphCard key={i} graph={graph} figure={figure} />
          ))}
        </Flex>
      )}
    </Flex>
  );
}
