import { useRef } from 'react';
import { AlertDialog, Box, Button, Flex, Heading, Text } from '@radix-ui/themes';
import { Plus, Trash2 } from 'lucide-react';

export default function LeftPanel({ datasets, activeDataset, onSelectDataset, onUpload, onDeleteDataset }) {
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onUpload(file);
      e.target.value = '';
    }
  };

  return (
    <div className="left-panel">
      <Box px="3" py="3" style={{ borderBottom: '1px solid var(--gray-a4)', flexShrink: 0 }}>
        <Flex align="center" justify="between">
          <Heading size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Datasets
          </Heading>
          <button
            className="add-dataset-btn"
            onClick={() => inputRef.current?.click()}
            title="Upload new dataset"
          >
            <Plus size={13} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </Flex>
      </Box>

      <div className="left-panel-scroll">
        {datasets.length === 0 && (
          <Text size="1" color="gray" style={{ padding: '8px 4px' }}>No datasets yet</Text>
        )}
        {datasets.map((ds) => (
          <AlertDialog.Root key={ds.id}>
            <div
              className={`dataset-item${activeDataset?.id === ds.id ? ' active' : ''}`}
              onClick={() => onSelectDataset(ds.id)}
            >
              <Text size="2" weight={activeDataset?.id === ds.id ? 'medium' : 'regular'} truncate style={{ flex: 1, minWidth: 0 }}>
                {ds.name}
              </Text>
              <AlertDialog.Trigger asChild>
                <button
                  type="button"
                  className="delete-dataset-btn"
                  onClick={(e) => e.stopPropagation()}
                  title="Delete dataset"
                >
                  <Trash2 size={12} />
                </button>
              </AlertDialog.Trigger>
            </div>
            <AlertDialog.Content maxWidth="450px">
              <AlertDialog.Title>Delete dataset</AlertDialog.Title>
              <AlertDialog.Description size="2">
                Are you sure you want to delete &quot;{ds.name}&quot;? This will permanently remove the dataset and all associated data (logs, garbage files). This action cannot be undone.
              </AlertDialog.Description>
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray">Cancel</Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action>
                  <Button color="red" onClick={() => onDeleteDataset(ds.id)}>Delete</Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        ))}
      </div>
    </div>
  );
}
