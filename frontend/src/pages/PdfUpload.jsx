import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { uploadPdf, getPdfSummary } from '../api/pdf';
import PdfSummaryCard from '../components/pdf/PdfSummaryCard';

const MAX_SIZE = 52428800; // 50MB

export default function PdfUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);

  const onDrop = useCallback(async (acceptedFiles, rejectedFiles) => {
    if (rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      const code = rejection.errors[0]?.code;
      if (code === 'file-too-large') {
        setError('File exceeds 50MB limit. Please select a smaller PDF.');
      } else if (code === 'file-invalid-type') {
        setError('Only PDF files are accepted.');
      } else {
        setError('File rejected. Please select a valid PDF under 50MB.');
      }
      return;
    }

    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setError(null);
    setSummary(null);
    setUploading(true);
    setProgress(0);

    try {
      // Simulate early progress
      setProgress(20);
      const uploadResult = await uploadPdf(file);
      setProgress(90);

      const { docUuid } = uploadResult;
      const summaryResult = await getPdfSummary(docUuid);
      setProgress(100);
      setSummary(summaryResult);
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_SIZE,
    multiple: false,
    disabled: uploading,
  });

  const handleRetry = () => {
    setError(null);
    setSummary(null);
    setProgress(0);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">PDF Ingestion</h1>
      <p className="text-gray-400 mb-6 text-sm">
        Upload a PDF to extract entities and index it for A.L.E.C. to reference in chat.
      </p>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={[
          'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
          isDragActive
            ? 'border-alec-accent bg-alec-accent/10'
            : 'border-gray-600 hover:border-gray-400 bg-alec-800/40',
          uploading ? 'opacity-50 cursor-not-allowed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <svg
            className="w-12 h-12 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          {isDragActive ? (
            <p className="text-alec-accent font-medium">Drop the PDF here…</p>
          ) : (
            <p className="text-gray-300 font-medium">
              Drag &amp; drop a PDF here, or click to select
            </p>
          )}
          <p className="text-gray-500 text-sm">Max 50MB</p>
        </div>
      </div>

      {/* Progress bar */}
      {uploading && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>Uploading &amp; processing…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-alec-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !uploading && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-start justify-between gap-4">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={handleRetry}
            className="shrink-0 text-sm px-3 py-1 border border-red-600 text-red-400 hover:bg-red-800/30 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary card */}
      {summary && !uploading && <PdfSummaryCard summary={summary} />}
    </div>
  );
}
