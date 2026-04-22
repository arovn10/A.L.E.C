import { useNavigate } from 'react-router-dom';

export default function PdfSummaryCard({ summary }) {
  const navigate = useNavigate();

  if (!summary) return null;

  const { docUuid, chunks, sourceType, entities = [], indexedAt } = summary;

  return (
    <div className="bg-alec-800 border border-gray-700 rounded-lg p-6 mt-6">
      <h2 className="text-lg font-semibold text-white mb-4">Document Summary</h2>

      <div className="grid grid-cols-2 gap-6">
        {/* Left column — metadata */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Metadata
          </h3>
          <dl className="space-y-2">
            <div>
              <dt className="text-xs text-gray-500">Document ID</dt>
              <dd className="text-sm text-gray-200 font-mono truncate">{docUuid}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Source Type</dt>
              <dd className="text-sm text-gray-200">{sourceType || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Chunks</dt>
              <dd className="text-sm text-gray-200">{chunks ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Indexed At</dt>
              <dd className="text-sm text-gray-200">
                {indexedAt ? new Date(indexedAt).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Right column — entities table */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Extracted Entities
          </h3>
          {entities.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No entities extracted.</p>
          ) : (
            <div className="overflow-auto max-h-64">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-1.5 pr-3 text-xs text-gray-400 font-medium">Type</th>
                    <th className="text-left py-1.5 pr-3 text-xs text-gray-400 font-medium">Value</th>
                    <th className="text-right py-1.5 text-xs text-gray-400 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((entity, idx) => (
                    <tr key={idx} className="border-b border-gray-800 hover:bg-alec-700/30">
                      <td className="py-1.5 pr-3 text-gray-300 capitalize">{entity.type}</td>
                      <td className="py-1.5 pr-3 text-gray-200">{entity.value}</td>
                      <td className="py-1.5 text-right text-gray-300">
                        {typeof entity.confidence === 'number'
                          ? `${Math.round(entity.confidence * 100)}%`
                          : entity.confidence ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <button
          onClick={() => navigate('/chat')}
          className="px-4 py-2 bg-alec-accent hover:bg-purple-600 text-white text-sm font-medium rounded-md transition-colors"
        >
          Ask A.L.E.C. about this document
        </button>
      </div>
    </div>
  );
}
