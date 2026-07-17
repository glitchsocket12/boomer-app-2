// Reusable search input for the People/Events/Groups list pages — filters the
// already-loaded list client-side as you type, no server round-trip needed
// since these lists are small (one person's own data).

export default function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={styles.input}
    />
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    fontSize: '1.1rem',
    padding: '0.65rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    marginBottom: '1.5rem',
    fontFamily: 'Georgia, serif',
  },
}
