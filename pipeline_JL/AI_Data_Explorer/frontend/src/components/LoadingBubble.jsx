import { Flex } from '@radix-ui/themes';

export default function LoadingBubble() {
  return (
    <Flex align="start" style={{ width: '100%', maxWidth: 640 }}>
      <div className="loading-dots">
        <span />
        <span />
        <span />
      </div>
    </Flex>
  );
}
