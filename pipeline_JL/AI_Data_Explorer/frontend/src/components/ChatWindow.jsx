import { useEffect, useRef } from 'react';
import { Flex } from '@radix-ui/themes';
import ChatMessage from './ChatMessage';
import LoadingBubble from './LoadingBubble';

export default function ChatWindow({ messages, loading }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="chat-scroll">
      <Flex
        direction="column"
        gap="3"
        px="4"
        pt="5"
        style={{ maxWidth: 880, margin: '0 auto', width: '100%', paddingBottom: '8rem' }}
      >
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {loading && <LoadingBubble />}
        <div ref={bottomRef} />
      </Flex>
    </div>
  );
}
