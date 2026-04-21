/**
 * frontend/src/pages/Settings/ConnectorFormField.jsx
 *
 * Renders one field from a connector definition. Passwords stay masked;
 * textareas take multi-line secrets (service account JSON etc.).
 */
export default function ConnectorFormField({ field, value, onChange, readOnly }) {
  const common = {
    value: value ?? '',
    onChange: (e) => onChange(e.target.value),
    readOnly: !!readOnly,
    className:
      'mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1 focus:outline-none focus:border-alec-accent',
  };

  let input;
  if (field.type === 'textarea') {
    input = <textarea {...common} rows={4} />;
  } else if (field.type === 'password') {
    input = <input type="password" autoComplete="new-password" {...common} />;
  } else {
    input = <input type={field.type === 'url' ? 'url' : 'text'} {...common} />;
  }

  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-200">
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {input}
    </label>
  );
}
