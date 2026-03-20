import { Box, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { Sparkles } from 'lucide-react';
import Plot from 'react-plotly.js';

export default function GraphCard({ graph, figure }) {
  return (
    <Card size="2">
      <Heading size="2" mb="1">{graph.title}</Heading>
      <Text size="1" color="gray" as="p" mb="3">{graph.reason}</Text>
      <Plot
        data={figure.data}
        layout={{ ...figure.layout, autosize: true }}
        config={{ displayModeBar: false, staticPlot: false }}
        style={{ width: '100%', height: '360px' }}
      />
      {graph.insight && (
        <Box
          mt="3"
          style={{
            borderLeft: '3px solid var(--accent-6)',
            background: 'var(--gray-a2)',
            borderRadius: '0 6px 6px 0',
            padding: '10px 14px',
          }}
        >
          <Flex align="center" gap="1" mb="1">
            <Sparkles size={12} style={{ color: 'var(--accent-9)', flexShrink: 0 }} />
            <Text size="1" weight="bold" style={{ color: 'var(--accent-9)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              AI Insight
            </Text>
          </Flex>
          <Text size="1" style={{ color: 'var(--gray-11)', lineHeight: 1.6 }}>
            {graph.insight}
          </Text>
        </Box>
      )}
    </Card>
  );
}
