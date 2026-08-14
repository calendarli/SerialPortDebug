type Props = {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}

export function Toggle({ label, value, onChange }: Props): React.JSX.Element {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  )
}
