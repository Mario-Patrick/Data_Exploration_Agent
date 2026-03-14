import { Card, Tabs } from '@radix-ui/themes';
import UploadButton from './UploadButton';
import CleaningTab from './CleaningTab';
import ExplorationTab from './ExplorationTab';

export default function ActionBar({
  activeDataset,
  loading,
  onUpload,
  onMessage,
  onLogRefresh,
  onSwitchToChat,
  pendingRegexEdit,
  onRegexEditConsumed,
}) {
  return (
    <div className="chat-float-bar">
      <Card
        size="2"
        style={{
          maxWidth: 748,
          margin: '0 auto',
          width: '85%',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      >
        {!activeDataset ? (
          <UploadButton onUpload={onUpload} disabled={loading} embedded />
        ) : (
          <Tabs.Root defaultValue="cleaning">
            <Tabs.List size="1">
              <Tabs.Trigger value="cleaning">Cleaning</Tabs.Trigger>
              <Tabs.Trigger value="exploration">Exploration</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="cleaning">
              <CleaningTab
                datasetId={activeDataset.id}
                columns={activeDataset.columns}
                onMessage={onMessage}
                onLogRefresh={onLogRefresh}
                onSwitchToChat={onSwitchToChat}
                pendingRegexEdit={pendingRegexEdit}
                onRegexEditConsumed={onRegexEditConsumed}
              />
            </Tabs.Content>

            <Tabs.Content value="exploration">
              <ExplorationTab
                datasetId={activeDataset.id}
                rowCount={activeDataset.row_count ?? 0}
                onMessage={onMessage}
                onSwitchToChat={onSwitchToChat}
              />
            </Tabs.Content>
          </Tabs.Root>
        )}
      </Card>
    </div>
  );
}
