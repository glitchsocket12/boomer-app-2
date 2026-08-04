// Reusable search input for the People/Events/Groups list pages — filters the
// already-loaded list client-side as you type, no server round-trip needed
// since these lists are small (one person's own data).

import { border, fontFamily, fontSize, radius, space } from '../lib/theme'

export default function SearchBox({
  value,
  onChange,
  placeholder,
  onFocus,
  onBlur,
  onKeyDown,
  ariaProps,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  onFocus?: () => void
  onBlur?: () => void
  // Optional so callers that need arrow-key/Enter handling (SearchAddPicker's result list) can
  // own it without every plain filter box growing keyboard logic it has no list to drive.
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  ariaProps?: React.AriaAttributes & { role?: string }
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={styles.input}
      {...ariaProps}
    />
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    fontSize: fontSize.lead,
    padding: '0.65rem 0.9rem',
    borderRadius: radius.md,
    border: border.default,
    marginBottom: space.xxxl,
    fontFamily,
  },
}
