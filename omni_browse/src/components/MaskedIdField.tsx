'use client';

import React, { useState } from 'react';

interface Props {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  mask: (value: string) => string;
  sanitize: (raw: string) => string;
  valid: (value: string) => boolean;
  inputMode?: 'numeric' | 'text';
  fromSample?: boolean;
}

export const maskAadhaar = (v: string): string => {
  const d = v.replace(/\D/g, '');
  if (d.length === 12) return `XXXX XXXX ${d.slice(-4)}`;
  return d.length > 4 ? `${'X'.repeat(d.length - 4)}${d.slice(-4)}` : 'X'.repeat(d.length);
};

export const maskPan = (v: string): string => {
  const p = v.toUpperCase();
  return p.length === 10 ? `${p.slice(0, 3)}XXXXX${p.slice(-2)}` : `${p.slice(0, 3)}${'X'.repeat(Math.max(0, p.length - 3))}`;
};

export const maskMobile = (v: string): string => {
  const d = v.replace(/\D/g, '');
  return d.length > 3 ? `+91 ${'X'.repeat(d.length - 3)}${d.slice(-3)}` : 'X'.repeat(d.length);
};

/** The typed value is shown only while the field has focus; at rest it is masked on screen. */
export function MaskedIdField({ label, value, placeholder, onChange, mask, sanitize, valid, inputMode = 'text', fromSample }: Props) {
  const [focused, setFocused] = useState(false);
  const invalid = !focused && value.length > 0 && !valid(value);
  return (
    <label
      data-sensitive="true"
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border text-xs min-w-0 ${
        invalid ? 'border-red-300' : 'border-slate-200 focus-within:border-[#582be8]'
      }`}
      title={invalid ? `Check the ${label} number` : undefined}
    >
      <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} number`}
        value={focused ? value : value ? mask(value) : ''}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(sanitize(e.target.value))}
        className="min-w-0 flex-1 bg-transparent outline-none font-bold tracking-wider tabular-nums text-slate-800 placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
      />
      {fromSample && !focused && value && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">sample</span>
      )}
    </label>
  );
}
