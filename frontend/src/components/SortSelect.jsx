// A "Sort" dropdown for a list. options: { value: label }, in the order
// listed.
export default function SortSelect({ value, options, onChange }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-sm text-gray-500">
      Sort
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-black"
      >
        {Object.entries(options).map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
