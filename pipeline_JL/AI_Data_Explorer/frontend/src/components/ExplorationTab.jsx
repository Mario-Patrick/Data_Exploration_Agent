import { useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';

export default function ExplorationTab({ datasetId, onMessage, onSwitchToChat }) {
  const [running, setRunning] = useState(false);

  const handleGenerate = async () => {
    onSwitchToChat();
    onMessage({ type: 'user', text: 'Generate Charts' });
    setRunning(true);

    try {
      const res = await fetch(`/api/explore/${datasetId}`, { method: 'POST' });
      const json = await res.json();

      if (!res.ok) {
        onMessage({ type: 'assistant', text: `Error: ${json.error}` });
        return;
      }

      onMessage({
        type: 'assistant',
        text: json.summary,
        graphs: json.graphs,
        data: json.data,
      });
    } catch (err) {
      onMessage({ type: 'assistant', text: `Network error: ${err.message}` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="action-tab-content">
      <Flex gap="2" align="center" wrap="wrap">
        <Button size="2" variant="soft" onClick={handleGenerate} disabled={running}>
          {running ? 'Generating…' : 'Generate Charts'}
        </Button>
        <Text size="1" color="gray">AI-powered chart recommendations for your dataset</Text>
      </Flex>
    </div>
  );
}
