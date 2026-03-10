import { useState, useEffect } from 'react';
import { Text } from '@radix-ui/themes';

export default function LogView({ datasetId, refreshKey }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    if (!datasetId) return;
    fetch(`/api/logs/${datasetId}`)
      .then((r) => r.json())
      .then((d) => setLines(d.lines ?? []));
  }, [datasetId, refreshKey]);

  return (
    <div className="panel-view log-panel">
      {lines.length === 0 ? (
        <Text size="2" color="gray">No log entries yet.</Text>
      ) : (
        lines.map((line, i) => {
          const match = line.match(/^\[([^\]]+)\] (.+)$/);
          const ts = match?.[1] ?? '';
          const msg = match?.[2] ?? line;
          return (
            <div key={i} className="log-entry">
              <Text size="1" className="log-ts">{ts}</Text>
              <Text size="2">{msg}</Text>
            </div>
          );
        })
      )}
    </div>
  );
}
