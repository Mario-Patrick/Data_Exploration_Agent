import { useRef } from 'react';
import { Button, Card, Flex, Text } from '@radix-ui/themes';

// embedded=true: renders just the inner content (Card provided by ActionBar)
// embedded=false (default): renders its own Card (original standalone behaviour)
export default function UploadButton({ onUpload, disabled, embedded = false }) {
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onUpload(file);
      e.target.value = '';
    }
  };

  const inner = (
    <Flex align="center" gap="3">
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        style={{ flexShrink: 0 }}
      >
        {disabled ? 'Analyzing...' : 'Upload CSV'}
      </Button>
      <Text size="1" color="gray" style={{ flexGrow: 1 }}>
        {disabled
          ? 'Generating charts from your data…'
          : 'Upload any CSV file to generate charts automatically'}
      </Text>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </Flex>
  );

  if (embedded) return inner;

  return (
    <Card
      size="2"
      style={{
        maxWidth: 748,
        margin: '0 auto',
        width: '85%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}
    >
      {inner}
    </Card>
  );
}
