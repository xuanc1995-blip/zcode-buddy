import React from 'react';
import { avatarGrad, initialsOf } from '../util.js';

/** 账号头像：id 散列出稳定渐变色 + 名称首字符 */
export default function Avatar({ name, id, size = 38, ring = false }) {
  const [a, b] = avatarGrad(id);
  return (
    <div
      className={`avatar ${ring ? 'avatar-ring' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(135deg, ${a}, ${b})`,
        boxShadow: `0 6px 16px -6px ${a}99`,
      }}
      title={name}
    >
      {initialsOf(name)}
    </div>
  );
}
