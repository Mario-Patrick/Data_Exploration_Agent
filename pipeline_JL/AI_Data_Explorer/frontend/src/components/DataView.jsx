import DataTable from './DataTable';

export default function DataView({ datasetId }) {
  if (!datasetId) return null;
  return (
    <div className="panel-view panel-view--table">
      <DataTable fetchUrl={`/api/data/${datasetId}`} />
    </div>
  );
}
