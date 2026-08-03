import { colors, fontFamily, fontSize, maxWidth, neutral } from '../lib/theme'

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
    maxWidth: maxWidth.page,
    margin: '0 auto',
    padding: '0.75rem 1.5rem 0',
    fontFamily,
    fontSize: fontSize.body,
  },
  link: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    textDecoration: 'underline',
    fontSize: fontSize.body,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
  },
  current: { color: colors.textFaint },
  separator: { color: neutral.grey400, margin: '0 0.5rem' },
}
