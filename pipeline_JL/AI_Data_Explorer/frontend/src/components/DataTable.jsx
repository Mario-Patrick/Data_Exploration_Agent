import { useState, useEffect, useRef } from 'react';
import { Button, Flex, Table, Text } from '@radix-ui/themes';

// Estimate a reasonable default column width from the header text length
const estimateWidth = (name) => Math.max(name.length * 8 + 32, 64);

export default function DataTable({ fetchUrl }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [colWidths, setColWidths] = useState({});
  const resizing = useRef(null);

  // Reset to page 1 when the URL changes (different dataset / action)
  useEffect(() => {
    setPage(1);
    setData(null);
  }, [fetchUrl]);

  useEffect(() => {
    if (!fetchUrl) return;
    setLoading(true);
    setError(null);
    fetch(`${fetchUrl}?page=${page}&per_page=50`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); } else { setData(d); }
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [fetchUrl, page]);

  // Initialise column widths from header text when columns change
  useEffect(() => {
    if (!data?.columns) return;
    setColWidths((prev) => {
      const next = {};
      for (const col of data.columns) {
        next[col] = prev[col] ?? estimateWidth(col);
      }
      return next;
    });
  }, [data?.columns?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const startResize = (e, col) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[col] ?? estimateWidth(col);

    const onMove = (e) => {
      const delta = e.clientX - startX;
      setColWidths((prev) => ({ ...prev, [col]: Math.max(40, startWidth + delta) }));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (error) return <Text size="2" color="red" style={{ padding: '16px 24px' }}>{error}</Text>;
  if (loading && !data) return <Text size="2" color="gray" style={{ padding: '16px 24px' }}>Loading…</Text>;
  if (!data) return null;

  return (
    <div className="data-table-wrap">
      <div className="data-table-scroll">
        <Table.Root size="1" variant="surface" layout="fixed">
          <colgroup>
            {data.columns.map((col) => (
              <col key={col} style={{ width: (colWidths[col] ?? estimateWidth(col)) + 'px' }} />
            ))}
          </colgroup>
          <Table.Header>
            <Table.Row>
              {data.columns.map((col) => (
                <Table.ColumnHeaderCell key={col} style={{ position: 'relative' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {col}
                  </span>
                  <div
                    className="col-resize-handle"
                    onMouseDown={(e) => startResize(e, col)}
                  />
                </Table.ColumnHeaderCell>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.rows.map((row, i) => (
              <Table.Row key={i}>
                {data.columns.map((col) => (
                  <Table.Cell key={col} title={String(row[col] ?? '')}>
                    {row[col] ?? <Text size="1" color="gray">null</Text>}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </div>

      <Flex align="center" justify="between" px="3" py="2" className="data-table-footer">
        <Text size="1" color="gray">
          {data.total.toLocaleString()} row{data.total !== 1 ? 's' : ''} total
        </Text>
        <Flex gap="2" align="center">
          <Button
            size="1" variant="soft"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </Button>
          <Text size="1" color="gray">
            Page {data.page} / {data.total_pages}
          </Text>
          <Button
            size="1" variant="soft"
            disabled={page >= data.total_pages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </Flex>
      </Flex>
    </div>
  );
}
