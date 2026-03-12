import { useState, useEffect } from 'react';
import { Box, Flex, Heading, Text, Badge } from '@radix-ui/themes';
import ChatWindow from './components/ChatWindow';
import ActionBar from './components/ActionBar';
import LeftPanel from './components/LeftPanel';
import DataView from './components/DataView';
import LogView from './components/LogView';
import GarbageView from './components/GarbageView';

let nextId = 1;

const MAIN_TABS = ['chat', 'data', 'logs', 'garbage'];

const WELCOME_MSG = {
  id: 0,
  type: 'assistant',
  text: "Upload a CSV file and I'll automatically generate charts and explain what they reveal about your data.",
};

const RESTORED_MSG = {
  id: 0,
  type: 'assistant',
  text: 'Dataset restored. Use the Exploration tab to generate charts, or the Cleaning tab to clean your data.',
};

export default function App() {
  // Per-dataset chat: { [datasetId]: [messages] }
  const [chatHistory, setChatHistory] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeDataset, setActiveDataset] = useState(null); // { id, name, columns }
  const [datasets, setDatasets] = useState([]);
  const [activeTab, setActiveTab] = useState('chat');
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  // Restore datasets from server on page load
  useEffect(() => {
    fetch('/api/datasets')
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) return;
        setDatasets(list.map((d) => ({ id: d.id, name: d.name, columns: d.columns ?? [] })));
        // Seed each restored dataset with a placeholder message
        const seeded = {};
        for (const d of list) seeded[d.id] = [{ ...RESTORED_MSG, id: nextId++ }];
        setChatHistory(seeded);
        const last = list[list.length - 1];
        setActiveDataset({ id: last.id, name: last.name, columns: last.columns ?? [] });
      })
      .catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Messages for the currently visible chat
  const currentMessages =
    activeDataset
      ? (chatHistory[activeDataset.id] ?? [RESTORED_MSG])
      : [WELCOME_MSG];

  const appendMessageToDataset = (dsId, msg) => {
    const id = nextId++;
    setChatHistory((prev) => ({
      ...prev,
      [dsId]: [...(prev[dsId] ?? []), { id, ...msg }],
    }));
  };

  // Used by CleaningTab / ExplorationTab — always has an activeDataset
  const appendMessage = (msg) => {
    if (activeDataset) appendMessageToDataset(activeDataset.id, msg);
  };

  const [pendingRegexEdit, setPendingRegexEdit] = useState(null);

  const handleAction = (action) => {
    if (action.type === 'edit_regex') {
      setPendingRegexEdit({ column: action.column, pattern: action.pattern });
      setActiveTab('chat');
    }
  };

  const handleLogRefresh = () => {
    setLogRefreshKey((k) => k + 1);
  };

  const handleUpload = async (file) => {
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        // Can't associate with a dataset yet — show in current chat or pre-upload
        if (activeDataset) {
          appendMessageToDataset(activeDataset.id, { type: 'assistant', text: `Server error: ${text.slice(0, 300)}` });
        }
        return;
      }

      if (!res.ok) {
        if (activeDataset) appendMessageToDataset(activeDataset.id, { type: 'assistant', text: `Error: ${json.error}` });
      } else {
        const ds = { id: json.dataset_id, name: file.name, columns: json.columns };
        setActiveDataset(ds);
        setDatasets((prev) => [...prev, { id: ds.id, name: ds.name, columns: ds.columns }]);
        setActiveTab('chat');

        // Seed the new dataset's chat
        appendMessageToDataset(ds.id, { type: 'user', text: `Uploaded: ${file.name}` });
        appendMessageToDataset(ds.id, {
          type: 'assistant',
          text: `Dataset loaded: ${json.row_count.toLocaleString()} rows, ${json.columns.length} columns. Use the Exploration tab to generate charts, or the Cleaning tab to clean your data.`,
        });
      }
    } catch (err) {
      if (activeDataset) appendMessageToDataset(activeDataset.id, { type: 'assistant', text: `Network error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDataset = async (id) => {
    try {
      const res = await fetch(`/api/datasets/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      const remaining = datasets.filter((d) => d.id !== id);
      setDatasets(remaining);
      setChatHistory((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeDataset?.id === id) {
        setActiveDataset(remaining.length > 0 ? { id: remaining[0].id, name: remaining[0].name, columns: [] } : null);
      }
    } catch {
      // non-critical
    }
  };

  const handleSelectDataset = (id) => {
    const ds = datasets.find((d) => d.id === id);
    if (!ds || activeDataset?.id === id) return;
    // Restore full columns from the already-fetched list if available
    setActiveDataset({ id: ds.id, name: ds.name, columns: ds.columns ?? [] });
    setLogRefreshKey((k) => k + 1);
  };

  const header = (
    <Box
      py="3"
      style={{ flexShrink: 0, textAlign: 'center', borderBottom: '1px solid var(--gray-a4)' }}
    >
      <Flex align="baseline" gap="2" justify="center">
        <Heading size="4" weight="bold">AI Data Explorer</Heading>
        {activeDataset
          ? <Badge color="sky" variant="soft" size="1">{activeDataset.name}</Badge>
          : <Text size="1" color="gray">Powered by DeepSeek</Text>}
      </Flex>
    </Box>
  );

  // Before any dataset is loaded — plain single-column layout, no tabs
  if (!activeDataset) {
    return (
      <div className="chat-layout">
        {header}
        <ChatWindow messages={currentMessages} loading={loading} onAction={handleAction} />
        <ActionBar
          activeDataset={null}
          loading={loading}
          onUpload={handleUpload}
          onMessage={appendMessage}
          onLogRefresh={handleLogRefresh}
          onSwitchToChat={() => setActiveTab('chat')}
          pendingRegexEdit={pendingRegexEdit}
          onRegexEditConsumed={() => setPendingRegexEdit(null)}
        />
      </div>
    );
  }

  // After upload — two-pane layout with main tab bar
  return (
    <div className="app-shell">
      <LeftPanel
        datasets={datasets}
        activeDataset={activeDataset}
        onSelectDataset={handleSelectDataset}
        onUpload={handleUpload}
        onDeleteDataset={handleDeleteDataset}
      />

      <div className="main-area">
        {header}

        {/* Main tab bar: Chat / Data / Logs / Garbage */}
        <div className="main-tab-bar">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab}
              className={`main-tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content fills remaining height */}
        <div className="tab-content-area">
          {activeTab === 'chat' && (
            <div className="chat-tab">
              <ChatWindow messages={currentMessages} loading={loading} onAction={handleAction} />
              <ActionBar
                activeDataset={activeDataset}
                loading={loading}
                onUpload={handleUpload}
                onMessage={appendMessage}
                onLogRefresh={handleLogRefresh}
                onSwitchToChat={() => setActiveTab('chat')}
                pendingRegexEdit={pendingRegexEdit}
                onRegexEditConsumed={() => setPendingRegexEdit(null)}
              />
            </div>
          )}
          {activeTab === 'data' && <DataView datasetId={activeDataset.id} />}
          {activeTab === 'logs' && (
            <LogView datasetId={activeDataset.id} refreshKey={logRefreshKey} />
          )}
          {activeTab === 'garbage' && (
            <GarbageView datasetId={activeDataset.id} refreshKey={logRefreshKey} />
          )}
        </div>
      </div>
    </div>
  );
}
