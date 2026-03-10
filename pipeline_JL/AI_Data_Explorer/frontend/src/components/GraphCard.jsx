import { Card, Heading, Text } from '@radix-ui/themes';
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
    </Card>
  );
}
