import { useState, useEffect } from 'react';
import { Button, Dialog, Flex, Slider, Text } from '@radix-ui/themes';

export default function ExplorationTab({ datasetId, rowCount = 0, onMessage, onSwitchToChat }) {
  const [running, setRunning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sampleSize, setSampleSize] = useState(0);

  useEffect(() => {
    if (dialogOpen && rowCount > 0) {
      setSampleSize(Math.min(50000, rowCount));
    }
  }, [dialogOpen, rowCount]);

  const handleGenerate = async () => {
    setDialogOpen(false);
    onSwitchToChat();
    onMessage({ type: 'user', text: 'Generate Charts' });
    setRunning(true);

    try {
      const res = await fetch(`/api/explore/${datasetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_size: sampleSize }),
      });
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

  const sampleLabel = sampleSize === 0 ? 'All rows' : `${sampleSize.toLocaleString()} rows`;

  return (
    <div className="action-tab-content">
      <Flex gap="2" align="center" wrap="wrap">
        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger asChild>
            <Button
              size="2"
              variant="soft"
              disabled={running || rowCount === 0}
            >
              {running ? 'Generating…' : 'Generate Charts'}
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="400px">
            <Dialog.Title>Sample size for charts</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="3">
              Choose how many rows to use for chart data. 0 = all rows; otherwise that many rows are chosen randomly (no repeats).
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
        <Text size="1" color="gray">AI-powered chart recommendations for your dataset</Text>
      </Flex>
    </div>
  );
}
