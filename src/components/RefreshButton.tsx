export default function RefreshButton({
  onClick,
  label,
  refreshing,
}: {
  onClick: () => void
  label: string
  refreshing?: boolean
}) {
  return (
    <button onClick={onClick} disabled={refreshing} aria-label={label} style={styles.button}>
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={refreshing ? styles.spinning : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    flexShrink: 0,
    borderRadius: '8px',
    border: '1px solid #E0E0E0',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  spinning: { animation: 'spin 0.8s linear infinite' },
}
