import React from 'react';

export default function Toast({ text, kind }) {
  return <div className={`toast ${kind}`}>{text}</div>;
}
