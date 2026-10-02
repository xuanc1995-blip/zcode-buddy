import React from 'react';

/** iOS 风格开关 */
export default function Toggle({ checked, onChange, disabled }) {
  return (
    <label className={`switch ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" />
    </label>
  );
}
