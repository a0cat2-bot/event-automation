type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name. Pass when the visible label is rendered by the caller. */
  label?: string;
};

/**
 * A settings switch.
 *
 * Deliberately still a real `<input type="checkbox">` styled as a switch rather than a div with
 * click handlers: that keeps keyboard operation, focus handling and screen-reader semantics for
 * free. `role="switch"` refines the announcement from "checkbox" to "switch".
 */
export function ToggleSwitch({ checked, onChange, disabled = false, label }: ToggleSwitchProps) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </span>
  );
}
