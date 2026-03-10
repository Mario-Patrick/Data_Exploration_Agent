import { useState, useEffect } from 'react';
import { Button, Flex, Table, Text } from '@radix-ui/themes';

// fetchUrl: base URL (page + per_page are appended as query params)
export default function DataTable({ fetchUrl }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  if (error) return <Text size="2" color="red">{error}</Text>;
  if (loading && !data) return <Text size="2" color="gray">Loading…</Text>;
  if (!data) return null;

  return (
    <div className="data-table-wrap">
      <div className="data-table-scroll">
        <Table.Root size="1" variant="surface" layout="fixed">
          <Table.Header>
            <Table.Row>
              {data.columns.map((col) => (
                <Table.ColumnHeaderCell key={col}>{col}</Table.ColumnHeaderCell>
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
