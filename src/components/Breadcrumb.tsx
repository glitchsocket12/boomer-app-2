type BreadcrumbItem = { label: string; onClick?: () => void }

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav style={styles.nav}>
      {items.map((item, i) => (
        <span key={i}>
          {item.onClick ? (
            <button onClick={item.onClick} style={styles.link}>{item.label}</button>
          ) : (
            <span style={styles.current}>{item.label}</span>
          )}
          {i < items.length - 1 && <span style={styles.separator}>→</span>}
        </span>
      ))}
    </nav>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  nav: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '0.75rem 1.5rem 0',
    fontFamily: 'Georgia, serif',
    fontSize: '0.9rem',
  },
  link: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    textDecoration: 'underline',
    fontSize: '0.9rem',
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
    padding: 0,
  },
  current: { color: '#888' },
  separator: { color: '#AAA', margin: '0 0.5rem' },
}
