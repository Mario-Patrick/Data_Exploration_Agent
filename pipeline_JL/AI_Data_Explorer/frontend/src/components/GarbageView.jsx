import { useState, useEffect } from 'react';
import { Button, Flex, Heading, Text } from '@radix-ui/themes';
import DataTable from './DataTable';

export default function GarbageView({ datasetId, refreshKey }) {
  const [files, setFiles] = useState([]);
  const [selectedAction, setSelectedAction] = useState(null);

  useEffect(() => {
    if (!datasetId) return;
    setSelectedAction(null);
    fetch(`/api/garbage/${datasetId}`)
      .then((r) => r.json())
      .then((d) => setFiles(d.files ?? []));
  }, [datasetId, refreshKey]);

  if (selectedAction) {
    return (
      <div className="panel-view">
        <Flex mb="3" align="center" gap="3" style={{ flexShrink: 0 }}>
          <Button size="1" variant="ghost" onClick={() => setSelectedAction(null)}>
            ← Back
          </Button>
          <Heading size="3">{selectedAction}</Heading>
          <Text size="1" color="gray">removed rows</Text>
        </Flex>
        <DataTable fetchUrl={`/api/garbage/${datasetId}/${selectedAction}`} />
      </div>
    );
  }

  return (
    <div className="panel-view">
      {files.length === 0 ? (
        <Text size="2" color="gray">
          No garbage files yet. Run a cleaning action to see removed rows here.
        </Text>
      ) : (
        files.map((f) => (
          <div
            key={f.action}
            className="garbage-item"
            onClick={() => setSelectedAction(f.action)}
          >
            <Text size="2" weight="medium" style={{ textTransform: 'capitalize' }}>
              {f.action}
            </Text>
            <Text size="1" color="gray">{f.row_count.toLocaleString()} rows removed</Text>
          </div>
        ))
      )}
    </div>
  );
}
