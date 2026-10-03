import React, { useEffect, useState } from 'react';
import { IconInfo, IconHeart, IconZap, IconFolder } from '../components/icons.jsx';

/** 关于页 */
export default function About({ state }) {
  const [version, setVersion] = useState('');
  useEffect(() => { window.buddy.getVersion().then(setVersion); }, []);

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>关于</h1>
          <p className="page-sub">ZCode Buddy v{version || '…'}</p>
        </div>
      </header>

      <section className="panel about">
        <div className="about-hero">
          <span className="logo"><IconZap size={26} /></span>
          <div>
            <b>ZCode Buddy</b>
            <div className="hint">开源的 ZCode 多账号快捷切换与额度管理桌面工具（MIT License）</div>
          </div>
        </div>
        <p className="hint block">原理：切换 = 备份并替换 <code>~\.zcode\v2\</code> 下的登录态文件；额度通过 ZCode billing 接口实时查询。所有数据仅保存在本机。</p>
        <div className="row-gap">
          <a className="btn" href="https://github.com/xuanc1995-blip/zcode-buddy" target="_blank" rel="noreferrer">GitHub 仓库</a>
          <a className="btn" href="https://github.com/xuanc1995-blip/zcode-buddy/releases" target="_blank" rel="noreferrer">检查新版本</a>
          <button className="btn ghost" onClick={() => window.buddy.openPath(state?.storeDir)}><IconFolder size={14} /> 打开数据目录</button>
        </div>
      </section>

      <section className="panel about">
        <h2><IconInfo size={15} /> 免责声明</h2>
        <p className="hint block">本项目与 ZCode / 智谱官方无任何隶属关系，仅供个人学习与效率工具使用，请遵守对应服务条款；使用本项目产生的任何后果由使用者自行承担。</p>
        <p className="hint block">设计参考了 WorkDaddy、zcode-account-switcher、ZCodex-Manager、workbuddy-switch 等优秀开源项目，感谢社区。<IconHeart size={12} /></p>
      </section>
    </div>
  );
}
